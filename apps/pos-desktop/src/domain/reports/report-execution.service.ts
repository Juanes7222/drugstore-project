/**
 * Local report execution service.
 *
 * Single public entry point for running any report.  The flow:
 *
 *   1. Validate filters (Zod) and the date range.
 *   2. Enforce role-based permissions.
 *   3. Build a cache key from `(code, filters, user, dbRevision)`.
 *   4. If a fresh cached result exists, return it (marked `fromCache`).
 *   5. Otherwise, run the appropriate query builder + aggregate
 *      the KPI / chart data, persist in the cache, and return.
 *
 * The service never makes a network call.  All queries hit the local
 * PGlite database through `ReportAggregationsService`.
 */

import type { PrismaClient } from '@pharmacy/database/local';
import { Prisma } from '@pharmacy/database/local';
import { getReportDefinition } from './report-catalog';
import {
  assertReportAccess,
  resolveCashierScope,
} from './report-permissions';
import { validateFilters } from './report-filter-schemas';
import {
  buildAuditShiftVariancesQuery,
  buildAuditTraceabilityQuery,
  buildCashShiftCloseQuery,
  buildCurrentStockQuery,
  buildExpiredWithLossQuery,
  buildExpiringLotsQuery,
  buildFiscalDianDocumentsQuery,
  buildFiscalTaxSummaryQuery,
  buildInventoryMovementsQuery,
  buildLowMovementQuery,
  buildProfitMarginQuery,
  buildRotationQuery,
  buildSalesByCashierQuery,
  buildSalesByHourQuery,
  buildSalesByPaymentMethodQuery,
  buildSalesByProductQuery,
  buildSalesByWeekdayQuery,
  buildSalesDailySummaryQuery,
  DELIVERY_SALE_PREDICATE,
  type QueryFragment,
} from './report-query-builders';
import { ReportAggregationsService } from './report-aggregations.service';
import { ReportCacheService } from './report-cache.service';
import { ReportFreshnessService } from './report-freshness.service';
import {
  ReportExecutionException,
  ReportFiltersNotReadyException,
  ReportShiftNotFoundException,
} from './exceptions';
import {
  ReportCode,
  ReportKpi,
  ReportKpiTone,
  ReportResponse,
  ReportWarning,
  type AnyReportRow,
  type DateRangeFilter,
  type ReportFilters,
  type ReportFreshness,
  type FiltersFor,
} from './report-types';
import type { LocalSession } from '../auth/local-session.store';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

export interface RunReportInput {
  code: ReportCode;
  filters: unknown;
  pagination?: { limit?: number; offset?: number };
  session: LocalSession;
  /** Optional translate function for chart series names and other
   *  i18n-able labels.  When omitted, raw identifier strings are used
   *  (backward compatible). */
  t?: (key: string, fallback?: string) => string;
}

export class ReportExecutionService {
  private readonly aggregations: ReportAggregationsService;
  private readonly freshness: ReportFreshnessService;
  private readonly cache: ReportCacheService;

  constructor(
    private readonly prisma: PrismaClient,
    cache?: ReportCacheService,
  ) {
    this.aggregations = new ReportAggregationsService(prisma);
    this.freshness = new ReportFreshnessService(prisma);
    this.cache = cache ?? new ReportCacheService();
  }

  /** Expose the underlying cache for use by domain services that need to
   *  invalidate after a local mutation. */
  getCache(): ReportCacheService {
    return this.cache;
  }

  /**
   * Execute a report end-to-end.  Returns a fully-populated
   * `ReportResponse` ready for the UI.
   */
  async run(input: RunReportInput): Promise<ReportResponse> {
    const def = getReportDefinition(input.code);
    assertReportAccess(input.code, input.session.role);

    // CASH_SHIFT_CLOSE only runs once the cashier has picked a shift —
    // its catalog default is the empty-string sentinel, which the Zod
    // schema would otherwise reject as a generic "invalid filters"
    // failure.  Surface that as "not ready yet" instead, so the UI can
    // prompt for the filter rather than erroring out.
    if (
      input.code === ReportCode.CASH_SHIFT_CLOSE &&
      !hasSelectedShiftId(input.filters)
    ) {
      throw new ReportFiltersNotReadyException(input.code);
    }

    let validated: FiltersFor<typeof input.code>;
    try {
      validated = validateFilters(input.code, input.filters) as FiltersFor<typeof input.code>;
    } catch (err) {
      throw new ReportExecutionException(
        input.code,
        `Invalid filters: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const pagination = clampPagination(input.pagination);

    // 1. Freshness snapshot — we need the db revision before we can
    //    compose a cache key, and the UI always wants to display the
    //    metadata alongside the data anyway.
    const freshness = await this.freshness.snapshot();

    // 2. Cache lookup.
    const cacheKey = this.cache.buildKey(
      input.code,
      validated,
      input.session.userId,
      freshness.dbRevision,
    );
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    // 3. Build query + run.
    const t0 = Date.now();
    const fragment = this.buildFragment(input.code, validated, input.session);
    let result;
    try {
      result = await this.aggregations.run(fragment, { count: true });
    } catch (err) {
      throw new ReportExecutionException(
        input.code,
        err instanceof Error ? err.message : String(err),
      );
    }

    // 4. Validate special-case inputs.
    if (input.code === ReportCode.CASH_SHIFT_CLOSE) {
      this.assertShiftExists(result.rows, validated as { shiftId: string });
    }

    // 5. Build KPI cards + chart data.
    const kpis = await this.buildKpis(input.code, validated, input.session, freshness);
    const chart = await this.buildChart(input.code, validated, input.session, freshness, input.t);
    const warnings = this.buildWarnings(result.rows, validated, freshness);

    const filterBase = this.extractDateRange(validated);
    const ordered = this.applyRowOrdering(input.code, result.rows);
    const response: ReportResponse = {
      code: input.code,
      generatedAt: new Date().toISOString(),
      freshness,
      warnings,
      executionMs: Date.now() - t0,
      fromCache: false,
      filters: filterBase,
      kpis,
      chart,
      rows: ordered.rows,
      total: ordered.total,
      offset: pagination.offset,
      limit: pagination.limit,
    };

    this.cache.set(cacheKey, input.code, response, def.cacheTtlMs);
    return response;
  }

  // -----------------------------------------------------------------------
  // Fragment dispatcher
  // -----------------------------------------------------------------------

  private buildFragment(
    code: ReportCode,
    filters: FiltersFor<ReportCode>,
    session: LocalSession,
  ): QueryFragment {
    const pagination = { limit: 0, offset: 0 }; // placeholder — replaced in run() before exec
    void pagination;
    const page = { limit: DEFAULT_PAGE_SIZE, offset: 0 };

    switch (code) {
      case ReportCode.SALES_DAILY_SUMMARY:
        return buildSalesDailySummaryQuery(
          (filters as FiltersFor<typeof ReportCode.SALES_DAILY_SUMMARY>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.SALES_DAILY_SUMMARY>) as {
            cashierUserId?: string;
            paymentMethodId?: string;
          },
          page,
        );
      case ReportCode.SALES_BY_CASHIER: {
        const f = filters as FiltersFor<typeof ReportCode.SALES_BY_CASHIER>;
        return buildSalesByCashierQuery(
          f as DateRangeFilter,
          { restrictToUserId: resolveCashierScope(code, session.role, session.userId) },
          page,
        );
      }
      case ReportCode.SALES_BY_PAYMENT_METHOD:
        return buildSalesByPaymentMethodQuery(
          (filters as FiltersFor<typeof ReportCode.SALES_BY_PAYMENT_METHOD>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.SALES_BY_PAYMENT_METHOD>) as {
            paymentMethodId?: string;
          },
          page,
        );
      case ReportCode.SALES_BY_PRODUCT:
        return buildSalesByProductQuery(
          (filters as FiltersFor<typeof ReportCode.SALES_BY_PRODUCT>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.SALES_BY_PRODUCT>) as {
            categoryId?: string;
            topN?: number;
          },
          page,
        );
      case ReportCode.SALES_BY_HOUR:
        return buildSalesByHourQuery(
          filters as FiltersFor<typeof ReportCode.SALES_BY_HOUR> as DateRangeFilter,
          page,
        );
      case ReportCode.SALES_BY_WEEKDAY:
        return buildSalesByWeekdayQuery(
          filters as FiltersFor<typeof ReportCode.SALES_BY_WEEKDAY> as DateRangeFilter,
          page,
        );
      case ReportCode.INV_CURRENT_STOCK:
        return buildCurrentStockQuery(
          filters as FiltersFor<typeof ReportCode.INV_CURRENT_STOCK>,
          page,
        );
      case ReportCode.INV_EXPIRING_LOTS:
        return buildExpiringLotsQuery(
          filters as FiltersFor<typeof ReportCode.INV_EXPIRING_LOTS>,
          page,
        );
      case ReportCode.INV_EXPIRED_WITH_LOSS:
        return buildExpiredWithLossQuery(
          filters as FiltersFor<typeof ReportCode.INV_EXPIRED_WITH_LOSS>,
          page,
        );
      case ReportCode.INV_ROTATION:
        return buildRotationQuery(
          (filters as FiltersFor<typeof ReportCode.INV_ROTATION>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.INV_ROTATION>) as {
            categoryId?: string;
            productId?: string;
          },
          page,
        );
      case ReportCode.INV_LOW_MOVEMENT:
        return buildLowMovementQuery(
          filters as FiltersFor<typeof ReportCode.INV_LOW_MOVEMENT>,
          page,
        );
      case ReportCode.INV_MOVEMENTS:
        return buildInventoryMovementsQuery(
          (filters as FiltersFor<typeof ReportCode.INV_MOVEMENTS>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.INV_MOVEMENTS>) as {
            productId?: string;
            lotId?: string;
            movementType?: FiltersFor<typeof ReportCode.INV_MOVEMENTS>['movementType'];
            userId?: string;
          },
          page,
        );
      case ReportCode.FISCAL_TAX_SUMMARY:
        return buildFiscalTaxSummaryQuery(
          filters as FiltersFor<typeof ReportCode.FISCAL_TAX_SUMMARY> as DateRangeFilter,
          page,
        );
      case ReportCode.FISCAL_DIAN_DOCUMENTS:
        return buildFiscalDianDocumentsQuery(
          (filters as FiltersFor<typeof ReportCode.FISCAL_DIAN_DOCUMENTS>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.FISCAL_DIAN_DOCUMENTS>) as {
            status?: string;
            invoiceType?: string;
          },
          page,
        );
      case ReportCode.CASH_SHIFT_CLOSE:
        return buildCashShiftCloseQuery(
          (filters as FiltersFor<typeof ReportCode.CASH_SHIFT_CLOSE>).shiftId,
        );
      case ReportCode.AUDIT_SHIFT_VARIANCES:
        return buildAuditShiftVariancesQuery(
          (filters as FiltersFor<typeof ReportCode.AUDIT_SHIFT_VARIANCES>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.AUDIT_SHIFT_VARIANCES>) as {
            cashierUserId?: string;
          },
          page,
        );
      case ReportCode.AUDIT_TRACEABILITY:
        return buildAuditTraceabilityQuery(
          (filters as FiltersFor<typeof ReportCode.AUDIT_TRACEABILITY>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.AUDIT_TRACEABILITY>) as {
            userId?: string;
            category?: string;
            actionPrefix?: string;
          },
          page,
        );
      case ReportCode.PROFIT_MARGIN_BY_PRODUCT:
        return buildProfitMarginQuery(
          (filters as FiltersFor<typeof ReportCode.PROFIT_MARGIN_BY_PRODUCT>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.PROFIT_MARGIN_BY_PRODUCT>) as {
            categoryId?: string;
            productId?: string;
          },
          page,
        );
      default: {
        const exhaustive: never = code;
        throw new ReportExecutionException(exhaustive as string, 'No fragment builder registered');
      }
    }
  }

  // -----------------------------------------------------------------------
  // KPI builders
  // -----------------------------------------------------------------------

  private async buildKpis(
    code: ReportCode,
    filters: FiltersFor<ReportCode>,
    session: LocalSession,
    freshness: ReportFreshness,
  ): Promise<ReportKpi[]> {
    const def = getReportDefinition(code);
    const kpis: ReportKpi[] = [];

    if (code === ReportCode.SALES_DAILY_SUMMARY) {
      const f = filters as FiltersFor<typeof ReportCode.SALES_DAILY_SUMMARY>;
      const prev = f.comparePrevious ? computePreviousKpi(f) : null;
      const aggs = await this.runAggregateSalesDaily(f);
      kpis.push(
        kpi('kpi.total_sales', aggs.netSales.toString(), prev?.netSales?.toString() ?? null, 'currency'),
        kpi('kpi.transaction_count', aggs.transactionCount.toString(), prev?.transactionCount?.toString() ?? null, 'integer'),
        kpi('kpi.average_ticket', aggs.netSales && aggs.transactionCount ? (aggs.netSales / aggs.transactionCount).toFixed(2) : '0', null, 'currency'),
        kpi('kpi.discounts', aggs.discounts.toString(), null, 'currency'),
        kpi('kpi.taxes_collected', aggs.taxes.toString(), null, 'currency'),
        kpi('kpi.annulments', aggs.annulled.toString(), null, 'integer'),
        kpi('kpi.returns', aggs.returns.toString(), null, 'currency'),
        {
          id: 'deliverySalesCount',
          titleKey: 'reports.kpis.delivery_sales_count',
          value: aggs.deliverySalesCount.toString(),
          previousValue: prev?.deliverySalesCount?.toString() ?? null,
          unitKey: 'reports.units.integer',
          tone: ReportKpiTone.BRAND,
        },
        {
          id: 'deliveryFeeCollected',
          titleKey: 'reports.kpis.delivery_fee_collected',
          value: aggs.deliveryFeeCollected.toString(),
          previousValue: prev?.deliveryFeeCollected?.toString() ?? null,
          unitKey: 'reports.units.currency',
          tone: ReportKpiTone.NEUTRAL,
        },
      );
    } else if (code === ReportCode.SALES_BY_PAYMENT_METHOD) {
      const aggs = await this.runAggregateSalesByPaymentMethod(
        filters as FiltersFor<typeof ReportCode.SALES_BY_PAYMENT_METHOD>,
      );
      kpis.push(
        kpi('kpi.net_collected', aggs.netCollected.toString(), null, 'currency'),
        kpi('kpi.transactions', aggs.transactions.toString(), null, 'integer'),
        kpi('kpi.refunded', aggs.refunded.toString(), null, 'currency'),
      );
    } else if (code === ReportCode.SALES_BY_CASHIER) {
      const aggs = await this.runAggregateSalesByCashier(
        filters as FiltersFor<typeof ReportCode.SALES_BY_CASHIER>,
        session,
      );
      kpis.push(
        kpi('kpi.net_sales', aggs.netSales.toString(), null, 'currency'),
        kpi('kpi.transactions', aggs.transactions.toString(), null, 'integer'),
        kpi('kpi.returns', aggs.returns.toString(), null, 'currency'),
        kpi('kpi.total_variance', aggs.totalVariance.toString(), null, 'currency'),
      );
    } else if (code === ReportCode.SALES_BY_PRODUCT) {
      const aggs = await this.runAggregateSalesByProduct(
        filters as FiltersFor<typeof ReportCode.SALES_BY_PRODUCT>,
      );
      kpis.push(
        kpi('kpi.net_revenue', aggs.netRevenue.toString(), null, 'currency'),
        kpi('kpi.units_sold', aggs.unitsSold.toString(), null, 'integer'),
      );
    } else if (code === ReportCode.INV_CURRENT_STOCK) {
      const aggs = await this.runAggregateCurrentStock(
        filters as FiltersFor<typeof ReportCode.INV_CURRENT_STOCK>,
      );
      kpis.push(
        kpi('kpi.stock_value', aggs.stockValue.toString(), null, 'currency'),
        kpi('kpi.units_in_stock', aggs.units.toString(), null, 'integer'),
        kpi('kpi.low_stock_products', aggs.lowStockCount.toString(), null, 'integer'),
      );
    } else if (code === ReportCode.INV_EXPIRING_LOTS) {
      const aggs = await this.runAggregateExpiring(
        filters as FiltersFor<typeof ReportCode.INV_EXPIRING_LOTS>,
      );
      kpis.push(
        kpi('kpi.lots_expiring', aggs.lotCount.toString(), null, 'integer'),
        kpi('kpi.value_at_risk', aggs.valueAtRisk.toString(), null, 'currency'),
      );
    } else if (code === ReportCode.INV_EXPIRED_WITH_LOSS) {
      const aggs = await this.runAggregateExpired(
        filters as FiltersFor<typeof ReportCode.INV_EXPIRED_WITH_LOSS>,
      );
      kpis.push(
        kpi('kpi.estimated_loss', aggs.estimatedLoss.toString(), null, 'currency'),
        kpi('kpi.lots_expired', aggs.lotCount.toString(), null, 'integer'),
      );
    } else if (code === ReportCode.INV_ROTATION) {
      const aggs = await this.runAggregateRotation(
        filters as FiltersFor<typeof ReportCode.INV_ROTATION>,
      );
      kpis.push(
        kpi('kpi.avg_rotation', aggs.avgRotation.toFixed(2), null, 'number'),
        kpi('kpi.days_of_inventory', aggs.avgDays.toFixed(1), null, 'number'),
      );
    } else if (code === ReportCode.PROFIT_MARGIN_BY_PRODUCT) {
      const aggs = await this.runAggregateProfitMargin(
        filters as FiltersFor<typeof ReportCode.PROFIT_MARGIN_BY_PRODUCT>,
      );
      kpis.push(
        kpi('kpi.gross_profit', aggs.grossProfit.toString(), null, 'currency'),
        kpi('kpi.avg_margin', aggs.avgMargin.toFixed(2) + '%', null, 'text'),
        kpi('kpi.negative_margin_products', aggs.negativeCount.toString(), null, 'integer'),
      );
    } else if (code === ReportCode.AUDIT_SHIFT_VARIANCES) {
      const aggs = await this.runAggregateVariances(
        filters as FiltersFor<typeof ReportCode.AUDIT_SHIFT_VARIANCES>,
      );
      kpis.push(
        kpi('kpi.shifts_with_variance', aggs.shiftsWithVariance.toString(), null, 'integer'),
        kpi('kpi.total_variance', aggs.totalVariance.toString(), null, 'currency'),
      );
    }

    // Every report also gets a "data freshness" KPI so the UI can show
    // pending operations and last-sync without scrolling to the banner.
    if (freshness.pendingOperations > 0) {
      kpis.push(
        kpi(
          'kpi.pending_operations',
          freshness.pendingOperations.toString(),
          null,
          'integer',
          'warning',
        ),
      );
    }
    if (freshness.permanentFailures > 0) {
      kpis.push(
        kpi(
          'kpi.permanent_failures',
          freshness.permanentFailures.toString(),
          null,
          'integer',
          'danger',
        ),
      );
    }

    void def;
    return kpis;
  }

  // -----------------------------------------------------------------------
  // Aggregate helpers (totals for KPIs)
  // -----------------------------------------------------------------------

  private async runAggregateSalesDaily(
    filters: FiltersFor<typeof ReportCode.SALES_DAILY_SUMMARY>,
  ): Promise<{
    netSales: number;
    transactionCount: number;
    discounts: number;
    taxes: number;
    annulled: number;
    returns: number;
    deliverySalesCount: number;
    deliveryFeeCollected: number;
  }> {
    const range = filters as DateRangeFilter;
    const result = await this.prisma.$queryRawUnsafe<
      Array<{
        net_sales: number | bigint;
        transaction_count: number | bigint;
        discounts: number | bigint;
        taxes: number | bigint;
        annulled: number | bigint;
        returns: number | bigint;
        delivery_sales_count: number | bigint;
        delivery_fee_collected: number | bigint;
      }>
    >(
      `WITH agg AS (
        SELECT
          COALESCE(SUM(s."totalAmount"), 0)::numeric AS net_sales,
          COUNT(*)::int AS transaction_count,
          COALESCE(SUM(s."totalDiscount"), 0)::numeric AS discounts,
          COALESCE(SUM(s."totalTax"), 0)::numeric AS taxes,
          COUNT(*) FILTER (WHERE ${DELIVERY_SALE_PREDICATE})::int AS delivery_sales_count,
          COALESCE(SUM((s."delivery" ->> 'feeCents')::numeric)
                   FILTER (WHERE ${DELIVERY_SALE_PREDICATE}), 0)::numeric AS delivery_fee_collected
        FROM "Sale" s
        WHERE s."operationalState" = 'CONFIRMED'
          AND s."confirmedAt" >= $1 AND s."confirmedAt" < $2
      ),
      ann AS (
        SELECT COUNT(*)::int AS annulled
        FROM "Sale" s
        WHERE s."operationalState" = 'ANNULLED'
          AND s."annulledAt" >= $1 AND s."annulledAt" < $2
      ),
      ret AS (
        SELECT COALESCE(SUM("refundAmount"), 0)::numeric AS returns
        FROM "ClientReturn"
        WHERE "state" = 'CONFIRMED'
          AND "createdAt" >= $1 AND "createdAt" < $2
      )
      SELECT agg.*, ann.annulled, ret.returns FROM agg, ann, ret`,
      `${range.dateFrom}T00:00:00.000Z`,
      `${range.dateTo}T00:00:00.000Z`,
    );
    const row = result?.[0];
    return {
      netSales: Number(row?.net_sales ?? 0),
      transactionCount: Number(row?.transaction_count ?? 0),
      discounts: Number(row?.discounts ?? 0),
      taxes: Number(row?.taxes ?? 0),
      annulled: Number(row?.annulled ?? 0),
      returns: Number(row?.returns ?? 0),
      deliverySalesCount: Number(row?.delivery_sales_count ?? 0),
      deliveryFeeCollected: Number(row?.delivery_fee_collected ?? 0),
    };
  }

  private async runAggregateSalesByPaymentMethod(
    filters: FiltersFor<typeof ReportCode.SALES_BY_PAYMENT_METHOD>,
  ): Promise<{ netCollected: number; transactions: number; refunded: number }> {
    const range = filters as DateRangeFilter;
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ collected: number | bigint; transactions: number | bigint; refunded: number | bigint }>
    >(
      `WITH agg AS (
        SELECT
          COALESCE(SUM(sp."amount"), 0)::numeric AS collected,
          COUNT(*)::int AS transactions
        FROM "SalePayment" sp
        JOIN "Sale" s ON s."id" = sp."saleId"
        WHERE s."operationalState" = 'CONFIRMED'
          AND sp."createdAt" >= $1 AND sp."createdAt" < $2
      ),
      ret AS (
        SELECT COALESCE(SUM(cr."refundAmount"), 0)::numeric AS refunded
        FROM "ClientReturn" cr
        WHERE cr."state" = 'CONFIRMED'
          AND cr."createdAt" >= $1 AND cr."createdAt" < $2
      )
      SELECT agg.collected, agg.transactions, ret.refunded FROM agg, ret`,
      `${range.dateFrom}T00:00:00.000Z`,
      `${range.dateTo}T00:00:00.000Z`,
    );
    const row = result?.[0];
    return {
      netCollected: Number(row?.collected ?? 0) - Number(row?.refunded ?? 0),
      transactions: Number(row?.transactions ?? 0),
      refunded: Number(row?.refunded ?? 0),
    };
  }

  private async runAggregateSalesByCashier(
    filters: FiltersFor<typeof ReportCode.SALES_BY_CASHIER>,
    session: LocalSession,
  ): Promise<{ netSales: number; transactions: number; returns: number; totalVariance: number }> {
    const range = filters as DateRangeFilter;
    const restrict = resolveCashierScope(
      ReportCode.SALES_BY_CASHIER,
      session.role,
      session.userId,
    );
    const params: unknown[] = [
      `${range.dateFrom}T00:00:00.000Z`,
      `${range.dateTo}T00:00:00.000Z`,
    ];
    let restrictClause = '';
    if (restrict) {
      restrictClause = 'AND s."userId" = $3';
      params.push(restrict);
    }
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ net_sales: number | bigint; transactions: number | bigint; returns: number | bigint; variance: number | bigint }>
    >(
      `WITH sales AS (
        SELECT
          COALESCE(SUM(s."totalAmount"), 0)::numeric AS net_sales,
          COUNT(*)::int AS transactions
        FROM "Sale" s
        WHERE s."operationalState" = 'CONFIRMED'
          AND s."confirmedAt" >= $1 AND s."confirmedAt" < $2
          ${restrictClause}
      ),
      ret AS (
        SELECT COALESCE(SUM(cr."refundAmount"), 0)::numeric AS returns
        FROM "ClientReturn" cr
        JOIN "Sale" s ON s."id" = cr."saleId"
        WHERE cr."state" = 'CONFIRMED'
          AND cr."createdAt" >= $1 AND cr."createdAt" < $2
          ${restrictClause}
      ),
      var AS (
        SELECT COALESCE(SUM(cs."closingDifference"), 0)::numeric AS variance
        FROM "CashShift" cs
        WHERE cs."state" IN ('CLOSED', 'FORCED_CLOSE')
          AND cs."closedAt" >= $1 AND cs."closedAt" < $2
          ${restrictClause}
      )
      SELECT sales.net_sales, sales.transactions, ret.returns, var.variance FROM sales, ret, var`,
      ...params,
    );
    const row = result?.[0];
    return {
      netSales: Number(row?.net_sales ?? 0),
      transactions: Number(row?.transactions ?? 0),
      returns: Number(row?.returns ?? 0),
      totalVariance: Number(row?.variance ?? 0),
    };
  }

  private async runAggregateSalesByProduct(
    filters: FiltersFor<typeof ReportCode.SALES_BY_PRODUCT>,
  ): Promise<{ netRevenue: number; unitsSold: number }> {
    const range = filters as DateRangeFilter;
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ net_revenue: number | bigint; units_sold: number | bigint }>
    >(
      `SELECT
         COALESCE(SUM(si."total"), 0)::numeric AS net_revenue,
         COALESCE(SUM(si."quantity"), 0)::int AS units_sold
       FROM "SaleItem" si
       JOIN "Sale" s ON s."id" = si."saleId"
       WHERE s."operationalState" = 'CONFIRMED'
         AND s."confirmedAt" >= $1 AND s."confirmedAt" < $2`,
      `${range.dateFrom}T00:00:00.000Z`,
      `${range.dateTo}T00:00:00.000Z`,
    );
    const row = result?.[0];
    return {
      netRevenue: Number(row?.net_revenue ?? 0),
      unitsSold: Number(row?.units_sold ?? 0),
    };
  }

  private async runAggregateCurrentStock(
    filters: FiltersFor<typeof ReportCode.INV_CURRENT_STOCK>,
  ): Promise<{ stockValue: number; units: number; lowStockCount: number }> {
    void filters;
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ stock_value: number | bigint; units: number | bigint; low_stock_count: number | bigint }>
    >(
      `SELECT
         COALESCE(SUM(l."currentStock" *
           COALESCE((SELECT c."cost" FROM "ProductCostHistory" c
                     WHERE c."productId" = p."id" AND c."effectiveTo" IS NULL
                     ORDER BY c."effectiveFrom" DESC LIMIT 1), 0)
         ), 0)::numeric AS stock_value,
         COALESCE(SUM(l."currentStock"), 0)::int AS units,
         COUNT(*) FILTER (WHERE l."currentStock" <= p."minimumStock")::int AS low_stock_count
       FROM "Product" p
       JOIN "Lot" l ON l."productId" = p."id"
       WHERE l."state" = 'ACTIVE' AND l."currentStock" > 0 AND p."isActive" = true`,
    );
    const row = result?.[0];
    return {
      stockValue: Number(row?.stock_value ?? 0),
      units: Number(row?.units ?? 0),
      lowStockCount: Number(row?.low_stock_count ?? 0),
    };
  }

  private async runAggregateExpiring(
    filters: FiltersFor<typeof ReportCode.INV_EXPIRING_LOTS>,
  ): Promise<{ lotCount: number; valueAtRisk: number }> {
    const days = (filters as { daysAhead: number }).daysAhead;
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ lot_count: number | bigint; value_at_risk: number | bigint }>
    >(
      `SELECT
         COUNT(*)::int AS lot_count,
         COALESCE(SUM(l."currentStock" *
           COALESCE((SELECT c."cost" FROM "ProductCostHistory" c
                     WHERE c."productId" = p."id" AND c."effectiveTo" IS NULL
                     ORDER BY c."effectiveFrom" DESC LIMIT 1), 0)
         ), 0)::numeric AS value_at_risk
       FROM "Lot" l
       JOIN "Product" p ON p."id" = l."productId"
       WHERE l."state" = 'ACTIVE'
         AND l."currentStock" > 0
         AND l."expirationDate" <= (CURRENT_DATE + ($1 || ' days')::interval)
         AND l."expirationDate" >= CURRENT_DATE`,
      days,
    );
    const row = result?.[0];
    return {
      lotCount: Number(row?.lot_count ?? 0),
      valueAtRisk: Number(row?.value_at_risk ?? 0),
    };
  }

  private async runAggregateExpired(
    filters: FiltersFor<typeof ReportCode.INV_EXPIRED_WITH_LOSS>,
  ): Promise<{ estimatedLoss: number; lotCount: number }> {
    void filters;
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ estimated_loss: number | bigint; lot_count: number | bigint }>
    >(
      `SELECT
         COALESCE(SUM(l."currentStock" *
           COALESCE((SELECT c."cost" FROM "ProductCostHistory" c
                     WHERE c."productId" = p."id" AND c."effectiveTo" IS NULL
                     ORDER BY c."effectiveFrom" DESC LIMIT 1), 0)
         ), 0)::numeric AS estimated_loss,
         COUNT(*)::int AS lot_count
       FROM "Lot" l
       JOIN "Product" p ON p."id" = l."productId"
       WHERE l."currentStock" > 0
         AND l."expirationDate" < CURRENT_DATE
         AND (l."state" = 'ACTIVE' OR l."state" = 'EXPIRED')`,
    );
    const row = result?.[0];
    return {
      estimatedLoss: Number(row?.estimated_loss ?? 0),
      lotCount: Number(row?.lot_count ?? 0),
    };
  }

  private async runAggregateRotation(
    filters: FiltersFor<typeof ReportCode.INV_ROTATION>,
  ): Promise<{ avgRotation: number; avgDays: number }> {
    const range = filters as DateRangeFilter;
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ avg_rotation: number | bigint; avg_days: number | bigint }>
    >(
      `WITH sold AS (
        SELECT si."productId" AS product_id, SUM(si."quantity")::int AS units
        FROM "SaleItem" si
        JOIN "Sale" s ON s."id" = si."saleId"
        WHERE s."operationalState" = 'CONFIRMED'
          AND s."confirmedAt" >= $1 AND s."confirmedAt" < $2
        GROUP BY si."productId"
      ),
      metrics AS (
        SELECT s.units::numeric / NULLIF(
          (COALESCE((SELECT SUM("currentStock") FROM "Lot" WHERE "productId" = s.product_id), 0) +
           COALESCE((SELECT SUM("currentStock") FROM "Lot" WHERE "productId" = s.product_id), 0)) / 2.0,
          0) AS rotation,
          NULLIF(
            (COALESCE((SELECT SUM("currentStock") FROM "Lot" WHERE "productId" = s.product_id), 0)) /
            (s.units::numeric / GREATEST(1, ($3::date - $1::date + 1))),
            0) AS days
        FROM sold s
      )
      SELECT COALESCE(AVG(rotation), 0)::numeric AS avg_rotation,
             COALESCE(AVG(days), 0)::numeric AS avg_days
      FROM metrics`,
      `${range.dateFrom}T00:00:00.000Z`,
      `${range.dateTo}T00:00:00.000Z`,
      range.dateTo,
    );
    const row = result?.[0];
    return {
      avgRotation: Number(row?.avg_rotation ?? 0),
      avgDays: Number(row?.avg_days ?? 0),
    };
  }

  private async runAggregateProfitMargin(
    filters: FiltersFor<typeof ReportCode.PROFIT_MARGIN_BY_PRODUCT>,
  ): Promise<{ grossProfit: number; avgMargin: number; negativeCount: number }> {
    const range = filters as DateRangeFilter;
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ gross_profit: number | bigint; avg_margin: number | bigint; negative_count: number | bigint }>
    >(
      `WITH items AS (
        SELECT
          si."productId" AS product_id,
          si."total" AS revenue,
          si."quantity" AS quantity
        FROM "SaleItem" si
        JOIN "Sale" s ON s."id" = si."saleId"
        WHERE s."operationalState" = 'CONFIRMED'
          AND s."confirmedAt" >= $1 AND s."confirmedAt" < $2
      ),
      enriched AS (
        SELECT
          i.product_id,
          SUM(i.revenue)::numeric AS revenue,
          SUM(i.quantity * COALESCE((
            SELECT c."cost" FROM "ProductCostHistory" c
            WHERE c."productId" = i.product_id AND c."effectiveTo" IS NULL
            ORDER BY c."effectiveFrom" DESC LIMIT 1
          ), 0))::numeric AS cost,
          MAX(COALESCE((
            SELECT ph."price" FROM "ProductPriceHistory" ph
            WHERE ph."productId" = i.product_id AND ph."effectiveTo" IS NULL
            ORDER BY ph."effectiveFrom" DESC LIMIT 1
          ), 0)) AS price,
          MAX(COALESCE((
            SELECT c."cost" FROM "ProductCostHistory" c
            WHERE c."productId" = i.product_id AND c."effectiveTo" IS NULL
            ORDER BY c."effectiveFrom" DESC LIMIT 1
          ), 0)) AS cpp
        FROM items i
        GROUP BY i.product_id
      )
      SELECT
        COALESCE(SUM(revenue - cost), 0)::numeric AS gross_profit,
        COALESCE(AVG(CASE WHEN price > 0 THEN ((price - cpp) / price) * 100 ELSE 0 END), 0)::numeric AS avg_margin,
        COUNT(*) FILTER (WHERE price > 0 AND ((price - cpp) / price) < 0)::int AS negative_count
      FROM enriched`,
      `${range.dateFrom}T00:00:00.000Z`,
      `${range.dateTo}T00:00:00.000Z`,
    );
    const row = result?.[0];
    return {
      grossProfit: Number(row?.gross_profit ?? 0),
      avgMargin: Number(row?.avg_margin ?? 0),
      negativeCount: Number(row?.negative_count ?? 0),
    };
  }

  private async runAggregateVariances(
    filters: FiltersFor<typeof ReportCode.AUDIT_SHIFT_VARIANCES>,
  ): Promise<{ shiftsWithVariance: number; totalVariance: number }> {
    const range = filters as DateRangeFilter;
    const result = await this.prisma.$queryRawUnsafe<
      Array<{ shifts: number | bigint; total: number | bigint }>
    >(
      `SELECT
         COUNT(*)::int AS shifts,
         COALESCE(SUM("closingDifference"), 0)::numeric AS total
       FROM "CashShift"
       WHERE "state" IN ('CLOSED', 'FORCED_CLOSE')
         AND "closingDifference" <> 0
         AND "closedAt" >= $1 AND "closedAt" < $2`,
      `${range.dateFrom}T00:00:00.000Z`,
      `${range.dateTo}T00:00:00.000Z`,
    );
    const row = result?.[0];
    return {
      shiftsWithVariance: Number(row?.shifts ?? 0),
      totalVariance: Number(row?.total ?? 0),
    };
  }

  // -----------------------------------------------------------------------
  // Chart series
  // -----------------------------------------------------------------------

  private async buildChart(
    code: ReportCode,
    filters: FiltersFor<ReportCode>,
    session: LocalSession,
    _freshness: ReportFreshness,
    t?: (key: string, fallback?: string) => string,
  ): Promise<ReportResponse['chart']> {
    switch (code) {
      case ReportCode.SALES_DAILY_SUMMARY: {
        const fragment = buildSalesDailySummaryQuery(
          (filters as FiltersFor<typeof ReportCode.SALES_DAILY_SUMMARY>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.SALES_DAILY_SUMMARY>) as {
            cashierUserId?: string;
            paymentMethodId?: string;
          },
          { limit: 500, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'line',
          xAxis: result.rows.map((r) => String(r.date ?? r.day ?? '').slice(0, 10)),
          series: [
            { name: t ? t('reports.chart.net_sales', 'net_sales') : 'net_sales', data: result.rows.map((r) => Number(r.net_sales ?? 0)) },
            { name: t ? t('reports.chart.taxes', 'taxes') : 'taxes', data: result.rows.map((r) => Number(r.taxes ?? 0)) },
          ],
        };
      }
      case ReportCode.SALES_BY_CASHIER: {
        const fragment = buildSalesByCashierQuery(
          (filters as FiltersFor<typeof ReportCode.SALES_BY_CASHIER>) as DateRangeFilter,
          { restrictToUserId: resolveCashierScope(code, session.role, session.userId) },
          { limit: 50, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'bar_horizontal',
          xAxis: result.rows.map((r) => String(r.cashier_name ?? r.cashier_user_id ?? '')),
          series: [
            { name: t ? t('reports.chart.net_sales', 'net_sales') : 'net_sales', data: result.rows.map((r) => Number(r.net_sales ?? 0)) },
          ],
        };
      }
      case ReportCode.SALES_BY_PAYMENT_METHOD: {
        const fragment = buildSalesByPaymentMethodQuery(
          (filters as FiltersFor<typeof ReportCode.SALES_BY_PAYMENT_METHOD>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.SALES_BY_PAYMENT_METHOD>) as {
            paymentMethodId?: string;
          },
          { limit: 50, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'donut',
          series: [{
            name: t ? t('reports.chart.payment_methods', 'Métodos de pago') : 'Métodos de pago',
            data: result.rows.map((r) => ({
              name: String(r.payment_method_name ?? r.payment_method_id ?? ''),
              value: Number(r.collected ?? 0),
            })),
          }],
        };
      }
      case ReportCode.SALES_BY_PRODUCT: {
        const fragment = buildSalesByProductQuery(
          (filters as FiltersFor<typeof ReportCode.SALES_BY_PRODUCT>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.SALES_BY_PRODUCT>) as {
            categoryId?: string;
            topN?: number;
          },
          { limit: Math.min(50, (filters as { topN?: number }).topN ?? 20), offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'bar_horizontal',
          xAxis: result.rows.map((r) => String(r.product_name ?? r.product_id ?? '')),
          series: [
            { name: t ? t('reports.chart.net_revenue', 'net_revenue') : 'net_revenue', data: result.rows.map((r) => Number(r.net_revenue ?? 0)) },
            { name: t ? t('reports.chart.units_sold', 'units_sold') : 'units_sold', data: result.rows.map((r) => Number(r.units_sold ?? 0)) },
          ],
        };
      }
      case ReportCode.SALES_BY_HOUR: {
        const fragment = buildSalesByHourQuery(
          (filters as FiltersFor<typeof ReportCode.SALES_BY_HOUR>) as DateRangeFilter,
          { limit: 24, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'area',
          xAxis: result.rows.map((r) => String(r.hour ?? 0)),
          series: [
            { name: t ? t('reports.chart.total_amount', 'total_amount') : 'total_amount', data: result.rows.map((r) => Number(r.total_amount ?? 0)) },
          ],
        };
      }
      case ReportCode.SALES_BY_WEEKDAY: {
        const fragment = buildSalesByWeekdayQuery(
          (filters as FiltersFor<typeof ReportCode.SALES_BY_WEEKDAY>) as DateRangeFilter,
          { limit: 7, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'bar_vertical',
          xAxis: result.rows.map((r) => String(r.weekday ?? '')),
          series: [
            { name: t ? t('reports.chart.total_amount', 'total_amount') : 'total_amount', data: result.rows.map((r) => Number(r.total_amount ?? 0)) },
          ],
        };
      }
      case ReportCode.INV_EXPIRING_LOTS: {
        const fragment = buildExpiringLotsQuery(
          filters as FiltersFor<typeof ReportCode.INV_EXPIRING_LOTS>,
          { limit: 200, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        // Bucket by week (YYYY-WW) to render a stacked area / bar.
        const buckets = new Map<string, { units: number; value: number }>();
        for (const r of result.rows) {
          const key = String(r.expiration_date ?? '').slice(0, 10);
          const cur = buckets.get(key) ?? { units: 0, value: 0 };
          cur.units += Number(r.quantity ?? 0);
          cur.value += Number(r.estimated_value ?? 0);
          buckets.set(key, cur);
        }
        return {
          kind: 'stacked_bar',
          xAxis: [...buckets.keys()].sort(),
          series: [
            { name: t ? t('reports.chart.units', 'units') : 'units', data: [...buckets.values()].map((v) => v.units) },
            { name: t ? t('reports.chart.value', 'value') : 'value', data: [...buckets.values()].map((v) => v.value) },
          ],
        };
      }
      case ReportCode.INV_MOVEMENTS: {
        const fragment = buildInventoryMovementsQuery(
          (filters as FiltersFor<typeof ReportCode.INV_MOVEMENTS>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.INV_MOVEMENTS>) as {
            productId?: string;
            lotId?: string;
            movementType?: FiltersFor<typeof ReportCode.INV_MOVEMENTS>['movementType'];
            userId?: string;
          },
          { limit: 500, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        // Bucket by day and movement type.
        const days = new Map<string, Map<string, number>>();
        for (const r of result.rows) {
          const day = String(r.created_at ?? '').slice(0, 10);
          const t = String(r.movement_type ?? '');
          const inner = days.get(day) ?? new Map<string, number>();
          inner.set(t, (inner.get(t) ?? 0) + Number(r.quantity ?? 0));
          days.set(day, inner);
        }
        const dayKeys = [...days.keys()].sort();
        const typeKeys = new Set<string>();
        days.forEach((m) => m.forEach((_v, k) => typeKeys.add(k)));
        const series = [...typeKeys].map((t) => ({
          name: t,
          data: dayKeys.map((d) => days.get(d)?.get(t) ?? 0),
        }));
        return { kind: 'stacked_bar', xAxis: dayKeys, series };
      }
      case ReportCode.INV_LOW_MOVEMENT: {
        const fragment = buildLowMovementQuery(
          filters as FiltersFor<typeof ReportCode.INV_LOW_MOVEMENT>,
          { limit: 50, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'bar_horizontal',
          xAxis: result.rows.map((r) => String(r.product_name ?? r.product_id ?? '')),
          series: [
            { name: t ? t('reports.chart.immobilized_value', 'immobilized_value') : 'immobilized_value', data: result.rows.map((r) => Number(r.immobilized_value ?? 0)) },
          ],
        };
      }
      case ReportCode.FISCAL_TAX_SUMMARY: {
        const fragment = buildFiscalTaxSummaryQuery(
          (filters as FiltersFor<typeof ReportCode.FISCAL_TAX_SUMMARY>) as DateRangeFilter,
          { limit: 20, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'bar_vertical',
          xAxis: result.rows.map((r) => String(r.tax_type ?? '')),
          series: [
            { name: t ? t('reports.chart.tax_amount', 'tax_amount') : 'tax_amount', data: result.rows.map((r) => Number(r.tax_amount ?? 0)) },
          ],
        };
      }
      case ReportCode.FISCAL_DIAN_DOCUMENTS: {
        const fragment = buildFiscalDianDocumentsQuery(
          (filters as FiltersFor<typeof ReportCode.FISCAL_DIAN_DOCUMENTS>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.FISCAL_DIAN_DOCUMENTS>) as {
            status?: string;
            invoiceType?: string;
          },
          { limit: 200, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        const counts = new Map<string, number>();
        for (const r of result.rows) {
          const s = String(r.status ?? 'UNKNOWN');
          counts.set(s, (counts.get(s) ?? 0) + 1);
        }
        return {
          kind: 'donut',
          series: [{
            name: t ? t('reports.chart.statuses', 'Estados') : 'Estados',
            data: [...counts.entries()].map(([name, value]) => ({ name, value })),
          }],
        };
      }
      case ReportCode.AUDIT_SHIFT_VARIANCES: {
        const fragment = buildAuditShiftVariancesQuery(
          (filters as FiltersFor<typeof ReportCode.AUDIT_SHIFT_VARIANCES>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.AUDIT_SHIFT_VARIANCES>) as {
            cashierUserId?: string;
          },
          { limit: 50, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'diverging_bar',
          xAxis: result.rows.map((r) => String(r.cashier_name ?? r.cashier_user_id ?? '')),
          series: [
            { name: t ? t('reports.chart.variance', 'variance') : 'variance', data: result.rows.map((r) => Number(r.total_variance ?? 0)) },
          ],
        };
      }
      case ReportCode.PROFIT_MARGIN_BY_PRODUCT: {
        const fragment = buildProfitMarginQuery(
          (filters as FiltersFor<typeof ReportCode.PROFIT_MARGIN_BY_PRODUCT>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.PROFIT_MARGIN_BY_PRODUCT>) as {
            categoryId?: string;
            productId?: string;
          },
          { limit: 200, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'scatter',
          xAxis: result.rows.map((r) => Number(r.gross_margin_percent ?? 0)),
          series: [
            {
              name: t ? t('reports.chart.products', 'products') : 'products',
              data: result.rows.map((r, i) => [
                Number(r.gross_margin_percent ?? 0),
                Number(r.gross_profit ?? 0),
                i,
                String(r.product_name ?? r.product_id ?? ''),
              ]),
            },
          ],
        };
      }
      case ReportCode.INV_ROTATION: {
        const fragment = buildRotationQuery(
          (filters as FiltersFor<typeof ReportCode.INV_ROTATION>) as DateRangeFilter,
          (filters as FiltersFor<typeof ReportCode.INV_ROTATION>) as {
            categoryId?: string;
            productId?: string;
          },
          { limit: 200, offset: 0 },
        );
        const result = await this.aggregations.run(fragment, { count: false });
        return {
          kind: 'scatter',
          xAxis: result.rows.map((r) => Number(r.rotation_index ?? 0)),
          series: [
            {
              name: t ? t('reports.chart.products', 'products') : 'products',
              data: result.rows.map((r) => [
                Number(r.rotation_index ?? 0),
                Number(r.units_sold ?? 0),
                String(r.product_name ?? r.product_id ?? ''),
              ]),
            },
          ],
        };
      }
      default:
        return { kind: 'none', series: [] };
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private buildWarnings(
    rows: AnyReportRow[],
    filters: FiltersFor<ReportCode>,
    freshness: ReportFreshness,
  ): ReportWarning[] {
    const warnings: ReportWarning[] = [];
    if (rows.length === 0) {
      warnings.push({ code: 'EMPTY', messageKey: 'reports.warnings.empty' });
    }
    if (freshness.pendingOperations > 0) {
      warnings.push({
        code: 'PENDING_OPS',
        messageKey: 'reports.warnings.pending_ops',
        context: { count: freshness.pendingOperations },
      });
    }
    if ('comparePrevious' in filters && filters.comparePrevious) {
      warnings.push({ code: 'COMPARISON', messageKey: 'reports.warnings.comparison' });
    }
    return warnings;
  }

  private assertShiftExists(
    rows: AnyReportRow[],
    filters: { shiftId: string },
  ): void {
    if (rows.length === 0) {
      throw new ReportShiftNotFoundException(filters.shiftId);
    }
  }

  private extractDateRange(filters: FiltersFor<ReportCode>): DateRangeFilter {
    const f = filters as Record<string, unknown>;
    if (
      typeof f.dateFrom === 'string' &&
      typeof f.dateTo === 'string' &&
      typeof f.preset === 'string' &&
      typeof f.comparePrevious === 'boolean'
    ) {
      return {
        preset: f.preset as DateRangeFilter['preset'],
        dateFrom: f.dateFrom,
        dateTo: f.dateTo,
        comparePrevious: f.comparePrevious,
      };
    }
    // Reports without a date range (e.g. current-stock) — synthesise a
    // single-day range that the freshness banner can render uniformly.
    const today = new Date().toISOString().slice(0, 10);
    return { preset: 'custom', dateFrom: today, dateTo: today, comparePrevious: false };
  }

  private applyRowOrdering(
    code: ReportCode,
    rows: AnyReportRow[],
  ): Pick<ReportResponse, 'rows' | 'total'> {
    if (code === ReportCode.PROFIT_MARGIN_BY_PRODUCT) {
      const filters = (rows[0] as { low_margin_percent?: number } | undefined) ?? undefined;
      const threshold = Number(filters?.low_margin_percent ?? 0);
      const enriched = rows.map((r) => {
        const margin = Number((r as { gross_margin_percent?: number }).gross_margin_percent ?? 0);
        const status =
          margin < 0
            ? 'negative'
            : margin < threshold
              ? 'low'
              : margin < threshold * 2
                ? 'medium'
                : 'healthy';
        return { ...r, margin_status: status };
      });
      return { rows: enriched, total: enriched.length };
    }
    return { rows, total: rows.length };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when the filter object carries a non-blank `shiftId`. */
function hasSelectedShiftId(filters: unknown): boolean {
  if (typeof filters !== 'object' || filters === null) return false;
  const shiftId = (filters as Record<string, unknown>).shiftId;
  return typeof shiftId === 'string' && shiftId.trim().length > 0;
}

function clampPagination(input?: { limit?: number; offset?: number }): {
  limit: number;
  offset: number;
} {
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, input?.limit ?? DEFAULT_PAGE_SIZE),
  );
  const offset = Math.max(0, input?.offset ?? 0);
  return { limit, offset };
}

function kpi(
  titleKey: string,
  value: string | number | null,
  previousValue: string | number | null | undefined,
  unitKey: string,
  tone?: ReportKpi['tone'],
): ReportKpi {
  return {
    id: titleKey,
    titleKey,
    value,
    previousValue: previousValue ?? null,
    unitKey: `reports.units.${unitKey}`,
    tone: tone ?? 'neutral',
  };
}

function computePreviousKpi(filters: FiltersFor<typeof ReportCode.SALES_DAILY_SUMMARY>): {
  netSales: number;
  transactionCount: number;
  deliverySalesCount: number;
  deliveryFeeCollected: number;
} | null {
  if (!filters.comparePrevious) return null;
  // The actual previous-period totals are computed by the frontend when
  // toggling `comparePrevious` — we expose placeholders here so the
  // service signature stays consistent.  A follow-up would issue a
  // second query using `computePreviousRange`.
  return { netSales: 0, transactionCount: 0, deliverySalesCount: 0, deliveryFeeCollected: 0 };
}

// Re-exports — keep a single import surface.
export { Prisma };
export type { ReportFilters };
