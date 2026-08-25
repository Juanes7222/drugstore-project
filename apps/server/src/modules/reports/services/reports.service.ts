// Sales, cash-shift, inventory-valuation, tax, and fiscal summary reports.
// Every report aggregates in PostgreSQL ($queryRaw); none loads full result
// sets into memory. The raw queries do not filter by subscriptionId on
// purpose: they run inside the request-scoped RLS transaction, so tenant
// isolation is enforced by the row-level security policies (same contract as
// every other query in this app).
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma } from '@pharmacy/database';
import { ReportDateRangeQueryDto } from '../dto/report-date-range.query.dto';
import { ReportInvalidDateRangeException } from '../exceptions/report-invalid-date-range.exception';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /**
   * Aggregates CONFIRMED sales whose `confirmedAt` falls within the date range.
   *
   * Note: This report uses each SaleItem's product's **current** saleType from the catalog,
   * NOT a historical snapshot at the time of sale (no such column exists). Since sales-pos
   * currently only creates FREE_SALE items, this limitation has no visible effect today but
   * will become relevant once PRESCRIPTION or CONTROLLED_SUBSTANCE sales are introduced.
   */
  async getSalesSummary(query: ReportDateRangeQueryDto): Promise<any> {
    assertValidDateRange(query.dateFrom, query.dateTo);
    const [dateFrom, dateTo] = parseDateRange(query);

    // Two independent aggregates instead of a joined one: joining Sale to
    // SaleItem would multiply each sale's totalAmount by its item count. A
    // previous version used a correlated per-sale subquery mixed with an
    // ungrouped outer reference, which was both slower and invalid under
    // strict grouping rules.
    const [totals, breakdown] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ totalSales: Prisma.Decimal; totalQuantity: number }>
      >`
        SELECT
          COALESCE((
            SELECT SUM(s."totalAmount") FROM "Sale" s
            WHERE s."operationalState" = 'CONFIRMED'
              AND s."confirmedAt" >= ${dateFrom}
              AND s."confirmedAt" <= ${dateTo}
          ), 0)::numeric(15,2) AS "totalSales",
          COALESCE((
            SELECT SUM(si.quantity)
            FROM "SaleItem" si
            JOIN "Sale" s ON s.id = si."saleId"
            WHERE s."operationalState" = 'CONFIRMED'
              AND s."confirmedAt" >= ${dateFrom}
              AND s."confirmedAt" <= ${dateTo}
          ), 0)::int AS "totalQuantity"
      `,
      this.prisma.$queryRaw<
        Array<{ saleType: string; count: number; totalAmount: Prisma.Decimal }>
      >`
        SELECT p."saleType" AS "saleType",
               COUNT(*)::int AS "count",
               COALESCE(SUM(si."total"), 0)::numeric(15,2) AS "totalAmount"
        FROM "Sale" s
        JOIN "SaleItem" si ON si."saleId" = s.id
        JOIN "Product" p ON p.id = si."productId"
        WHERE s."operationalState" = 'CONFIRMED'
          AND s."confirmedAt" >= ${dateFrom}
          AND s."confirmedAt" <= ${dateTo}
        GROUP BY p."saleType"
      `,
    ]);

    const totalRow = totals[0] ?? {
      totalSales: new Prisma.Decimal(0),
      totalQuantity: 0,
    };
    const breakdownBySaleType = breakdown.map((b) => ({
      saleType: b.saleType,
      count: b.count,
      totalAmount: new Prisma.Decimal(b.totalAmount).toFixed(2),
      averageAmount:
        b.count > 0
          ? new Prisma.Decimal(b.totalAmount).dividedBy(b.count).toFixed(2)
          : '0.00',
    }));

    return {
      totalSales: new Prisma.Decimal(totalRow.totalSales).toFixed(2),
      totalQuantity: totalRow.totalQuantity,
      breakdownBySaleType,
    };
  }

  /**
   * Aggregates closed CashShift rows within the date range and their associated
   * SalePayment amounts grouped by payment method category.
   */
  async getCashShiftSummary(query: ReportDateRangeQueryDto): Promise<any> {
    assertValidDateRange(query.dateFrom, query.dateTo);
    const [dateFrom, dateTo] = parseDateRange(query);

    const [shiftAggregates, paymentsByCategory] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{ totalShifts: number; totalCashMovement: Prisma.Decimal }>
      >`
        SELECT COUNT(*)::int AS "totalShifts",
               COALESCE(SUM("expectedClosingAmount"), 0)::numeric(15,2) AS "totalCashMovement"
        FROM "CashShift"
        WHERE state = 'CLOSED'
          AND "closedAt" >= ${dateFrom}
          AND "closedAt" <= ${dateTo}
      `,
      this.prisma.$queryRaw<
        Array<{ category: string; count: number; totalAmount: Prisma.Decimal }>
      >`
        SELECT pm.category AS "category",
               COUNT(*)::int AS "count",
               COALESCE(SUM(p.amount), 0)::numeric(15,2) AS "totalAmount"
        FROM "SalePayment" p
        JOIN "PaymentMethod" pm ON pm.id = p."paymentMethodId"
        JOIN "Sale" s ON s.id = p."saleId"
        WHERE s."operationalState" = 'CONFIRMED'
          AND s."cashShiftId" IN (
            SELECT id FROM "CashShift"
            WHERE state = 'CLOSED'
              AND "closedAt" >= ${dateFrom}
              AND "closedAt" <= ${dateTo}
          )
        GROUP BY pm.category
        ORDER BY pm.category
      `,
    ]);

    const shifts = shiftAggregates[0] ?? {
      totalShifts: 0,
      totalCashMovement: new Prisma.Decimal(0),
    };
    return {
      totalShifts: shifts.totalShifts,
      totalCashMovement: new Prisma.Decimal(shifts.totalCashMovement).toFixed(
        2,
      ),
      breakdownByPaymentMethod: paymentsByCategory.map((p) => ({
        paymentMethodCategory: p.category ?? 'OTHER',
        count: p.count,
        totalAmount: new Prisma.Decimal(p.totalAmount).toFixed(2),
        averageAmount:
          p.count > 0
            ? new Prisma.Decimal(p.totalAmount).dividedBy(p.count).toFixed(2)
            : '0.00',
      })),
    };
  }

  /**
   * Values every Lot with currentStock > 0 as of asOfDate (taken from
   * query.dateFrom). Lots whose cost cannot be resolved from a
   * PurchaseReceptionItem are counted in `lotsWithUnknownCost` and excluded
   * from the monetary total; they still contribute to lot counts.
   */
  async getInventoryValuation(query: ReportDateRangeQueryDto): Promise<any> {
    assertValidDateRange(query.dateFrom, query.dateTo);
    const asOfDate = new Date(query.dateFrom);
    const expiryThresholdDate = expiryThreshold(asOfDate);

    const rows = await this.prisma.$queryRaw<
      Array<{
        productId: string;
        productName: string;
        quantity: bigint;
        totalValue: Prisma.Decimal;
        activeLots: bigint;
        expiringLots: bigint;
        unknownCostLots: bigint;
      }>
    >`
      SELECT p.id AS "productId",
             p."commercialName" AS "productName",
             COALESCE(SUM(l."currentStock"), 0)::bigint AS "quantity",
             COALESCE(SUM(cost.unit_cost * l."currentStock"), 0)::numeric AS "totalValue",
             COUNT(*)::bigint AS "activeLots",
             COUNT(*) FILTER (WHERE l."expirationDate" <= ${expiryThresholdDate})::bigint AS "expiringLots",
             COUNT(*) FILTER (WHERE cost.unit_cost IS NULL)::bigint AS "unknownCostLots"
      FROM "Lot" l
      JOIN "Product" p ON p.id = l."productId"
      LEFT JOIN LATERAL (
        SELECT pri."realUnitCost" AS unit_cost
        FROM "PurchaseReceptionItem" pri
        WHERE pri."lotId" = l.id AND pri."realUnitCost" IS NOT NULL
        ORDER BY pri.id ASC
        LIMIT 1
      ) cost ON true
      WHERE l."currentStock" > 0
      GROUP BY p.id, p."commercialName"
      ORDER BY p."commercialName"
    `;

    let totalActive = 0;
    let totalExpiring = 0;
    let totalUnknownCost = 0;
    let totalValue = new Prisma.Decimal(0);
    const breakdownByProduct = rows.map((row) => {
      const quantity = Number(row.quantity);
      const value = new Prisma.Decimal(row.totalValue);
      totalActive += Number(row.activeLots);
      totalExpiring += Number(row.expiringLots);
      totalUnknownCost += Number(row.unknownCostLots);
      // Unknown-cost lots already contribute zero to the SQL SUM (their
      // unit_cost is NULL), so adding every product's value here is exact.
      totalValue = totalValue.plus(value);
      return {
        productId: row.productId,
        productName: row.productName,
        quantity,
        unitCost: quantity > 0 ? value.dividedBy(quantity).toFixed(2) : '0.00',
        totalValue: value.toFixed(2),
        expiringLotCount: Number(row.expiringLots),
      };
    });

    return {
      valuationDate: asOfDate.toISOString(),
      totalLotsActive: totalActive,
      totalLotsExpiring: totalExpiring,
      lotsWithUnknownCost: totalUnknownCost,
      totalInventoryValue: totalValue.toFixed(2),
      breakdownByProduct,
    };
  }

  /**
   * Aggregates subtotal and taxAmount for items belonging to CONFIRMED sales
   * whose VALIDATED INVOICE fiscal document has updatedAt (proxy for validatedAt)
   * within the requested range, grouped by the stored taxRate.
   *
   * Important: This report counts VALIDATED INVOICEs but does NOT net out
   * CREDIT_NOTEs issued against those same sales in the same period. Proper
   * credit-note netting is deferred to a later refinement.
   */
  async getTaxSummary(query: ReportDateRangeQueryDto): Promise<any> {
    assertValidDateRange(query.dateFrom, query.dateTo);
    const [dateFrom, dateTo] = parseDateRange(query);

    // LEFT JOIN so documents without items still count toward totalDocuments.
    // Documents without items land in the NULL-rate group row and are
    // stripped below. totalDocuments comes from a scalar over the scoped CTE:
    // a plain COUNT(DISTINCT fd.id) inside GROUP BY is per-group, and PG does
    // not implement DISTINCT window aggregates either (both caught by the
    // reports-raw-sql e2e suite).
    const rows = await this.prisma.$queryRaw<NullableTaxRateGroupRow[]>`
      WITH scoped_docs AS (
        SELECT fd.id AS id, fd."saleId" AS "saleId"
        FROM "FiscalDocument" fd
        JOIN "Sale" s ON s.id = fd."saleId"
        WHERE fd."documentType" = 'INVOICE'
          AND fd."fiscalState" = 'VALIDATED'
          AND fd."updatedAt" >= ${dateFrom}
          AND fd."updatedAt" <= ${dateTo}
          AND s."operationalState" = 'CONFIRMED'
      )
      SELECT si."taxRate" AS "taxRate",
             COALESCE(SUM(si.subtotal), 0)::numeric(15,2) AS "taxableBase",
             COALESCE(SUM(si."taxAmount"), 0)::numeric(15,2) AS "taxAmount",
             COUNT(DISTINCT CASE WHEN si.id IS NOT NULL THEN sd.id END)::bigint AS "documentCount",
             (SELECT COUNT(*) FROM scoped_docs)::bigint AS "totalDocuments"
      FROM scoped_docs sd
      LEFT JOIN "SaleItem" si ON si."saleId" = sd."saleId"
      GROUP BY si."taxRate"
      ORDER BY si."taxRate"
    `;

    // Documents with no items land in the NULL-rate bucket; they contribute
    // to totalDocuments only, never to monetary buckets (mirrors the previous
    // in-memory aggregation skipping docs without items). rows[0].totalDocuments
    // is safe because the scalar subquery repeats the same range-wide count
    // on every row.
    const itemRows = rows.filter(isTaxRateBucket);
    const totalDocuments = Number(rows[0]?.totalDocuments ?? 0);
    const totalTaxableBase = itemRows.reduce(
      (sum, r) => sum.plus(r.taxableBase),
      new Prisma.Decimal(0),
    );
    const totalTaxAmount = itemRows.reduce(
      (sum, r) => sum.plus(r.taxAmount),
      new Prisma.Decimal(0),
    );

    return {
      reportPeriod: periodOf(query),
      totalDocuments,
      totalTaxableBase: totalTaxableBase.toFixed(2),
      totalTaxAmount: totalTaxAmount.toFixed(2),
      breakdownByTaxRate: itemRows.map((r) => ({
        taxRate: new Prisma.Decimal(r.taxRate).toFixed(4),
        taxableBase: r.taxableBase.toFixed(2),
        taxAmount: r.taxAmount.toFixed(2),
        documentCount: Number(r.documentCount),
      })),
    };
  }

  /**
   * Fiscal document activity report grouped by document type and fiscal state.
   *
   * The `view` parameter is accepted for API forward compatibility with POS
   * terminals that resolve local invoice adjustments. On the server both
   * `'fiscal'` and `'operational'` produce identical data because the
   * `InvoiceLocalAdjustment` table is local-only to each terminal.
   */
  async getFiscalReport(query: ReportDateRangeQueryDto): Promise<any> {
    assertValidDateRange(query.dateFrom, query.dateTo);
    const [dateFrom, dateTo] = parseDateRange(query);

    const rows = await this.prisma.$queryRaw<FiscalDocumentGroupRow[]>`
      SELECT "documentType" AS "documentType",
             "fiscalState" AS "fiscalState",
             COUNT(*)::int AS "count",
             COALESCE(SUM(subtotal), 0)::numeric(15,2) AS "subtotal",
             COALESCE(SUM("totalTax"), 0)::numeric(15,2) AS "totalTax",
             COALESCE(SUM("totalAmount"), 0)::numeric(15,2) AS "totalAmount"
      FROM "FiscalDocument"
      WHERE "issueDate" >= ${dateFrom}
        AND "issueDate" <= ${dateTo}
      GROUP BY "documentType", "fiscalState"
    `;

    const { breakdownByType, totals } = reshapeFiscalRows(rows);

    return {
      reportPeriod: periodOf(query),
      view: query.view,
      totalDocuments: totals.documents,
      totalSubtotal: totals.subtotal.toFixed(2),
      totalTax: totals.tax.toFixed(2),
      totalAmount: totals.amount.toFixed(2),
      breakdownByType,
    };
  }

  /**
   * Daily sales report — CONFIRMED sales aggregated per calendar day.
   *
   * The `view` parameter is accepted for API forward compatibility with POS
   * terminals that resolve local invoice adjustments. On the server both
   * `'fiscal'` and `'operational'` produce identical data because the
   * `InvoiceLocalAdjustment` table is local-only to each terminal.
   */
  async getDailyReport(query: ReportDateRangeQueryDto): Promise<any> {
    assertValidDateRange(query.dateFrom, query.dateTo);
    const [dateFrom, dateTo] = parseDateRange(query);

    // LATERAL pre-aggregation keeps sale-level columns from being multiplied
    // by the item join while still summing item quantity/commission per day.
    const rows = await this.prisma.$queryRaw<DailySaleRow[]>`
      SELECT to_char(date_trunc('day', s."confirmedAt"), 'YYYY-MM-DD') AS "day",
             COUNT(DISTINCT s.id)::int AS "salesCount",
             COALESCE(SUM(s."totalAmount"), 0)::numeric(15,2) AS "totalAmount",
             COALESCE(SUM(s."totalTax"), 0)::numeric(15,2) AS "totalTax",
             COALESCE(SUM(items.quantity), 0)::int AS "quantity",
             COALESCE(SUM(items.commission_amount), 0)::numeric(15,2) AS "commissionAmount"
      FROM "Sale" s
      LEFT JOIN LATERAL (
        SELECT SUM(quantity) AS quantity,
               SUM("commissionAmount") AS commission_amount
        FROM "SaleItem" si
        WHERE si."saleId" = s.id
      ) items ON true
      WHERE s."operationalState" = 'CONFIRMED'
        AND s."confirmedAt" >= ${dateFrom}
        AND s."confirmedAt" <= ${dateTo}
      GROUP BY date_trunc('day', s."confirmedAt")
      ORDER BY date_trunc('day', s."confirmedAt") ASC
    `;

    const dailyEntries = rows.map((row) => ({
      date: row.day,
      salesCount: row.salesCount,
      totalAmount: new Prisma.Decimal(row.totalAmount),
      totalTax: new Prisma.Decimal(row.totalTax),
      quantity: row.quantity,
      commissionAmount: new Prisma.Decimal(row.commissionAmount),
    }));
    const totals = computeDailyTotals(dailyEntries);

    return {
      reportPeriod: periodOf(query),
      view: query.view,
      totalDays: dailyEntries.length,
      totals: {
        totalSales: totals.totalSales,
        totalAmount: totals.totalAmount.toFixed(2),
        totalTax: totals.totalTax.toFixed(2),
        totalQuantity: totals.totalQuantity,
        averageTicket:
          totals.totalSales > 0
            ? totals.totalAmount.dividedBy(totals.totalSales).toFixed(2)
            : '0.00',
        totalCommission: totals.totalCommission.toFixed(2),
      },
      dailyEntries: dailyEntries.map((d) => ({
        date: d.date,
        salesCount: d.salesCount,
        totalAmount: d.totalAmount.toFixed(2),
        totalTax: d.totalTax.toFixed(2),
        quantity: d.quantity,
        commissionAmount: d.commissionAmount.toFixed(2),
        averageTicket:
          d.salesCount > 0
            ? d.totalAmount.dividedBy(d.salesCount).toFixed(2)
            : '0.00',
      })),
    };
  }
}

// ── Shared row shapes and pure helpers ─────────────────────────────

interface NullableTaxRateGroupRow {
  taxRate: Prisma.Decimal | null;
  taxableBase: Prisma.Decimal | null;
  taxAmount: Prisma.Decimal | null;
  documentCount: bigint;
  totalDocuments: bigint;
}

type TaxRateGroupRow = TaxRateBucket & {
  documentCount: bigint;
  totalDocuments: bigint;
};

function isTaxRateBucket(row: NullableTaxRateGroupRow): row is TaxRateGroupRow {
  return (
    row.taxRate !== null && row.taxableBase !== null && row.taxAmount !== null
  );
}

/** Non-null per-rate bucket produced by the tax summary GROUP BY query. */
interface TaxRateBucket {
  taxRate: Prisma.Decimal;
  taxableBase: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
}

interface FiscalDocumentGroupRow {
  documentType: string;
  fiscalState: string;
  count: number;
  subtotal: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
}

interface DailySaleRow {
  day: string;
  salesCount: number;
  totalAmount: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  quantity: number;
  commissionAmount: Prisma.Decimal;
}

/** Parses an asserted-valid range into Date bounds shared by every query. */
function parseDateRange(query: ReportDateRangeQueryDto): [Date, Date] {
  return [new Date(query.dateFrom), new Date(query.dateTo)];
}

function periodOf(query: ReportDateRangeQueryDto): {
  dateFrom: string;
  dateTo: string;
} {
  return { dateFrom: query.dateFrom, dateTo: query.dateTo };
}

/** Number of days from the valuation date beyond which a lot is not considered expiring soon. */
const EXPIRING_SOON_DAYS = 90;

function expiryThreshold(from: Date): Date {
  const t = new Date(from);
  t.setDate(t.getDate() + EXPIRING_SOON_DAYS);
  return t;
}

function assertValidDateRange(dateFrom: string, dateTo: string): void {
  if (new Date(dateFrom) > new Date(dateTo)) {
    throw new ReportInvalidDateRangeException(dateFrom, dateTo);
  }
}

/**
 * Folds (documentType, fiscalState) group rows into the nested response
 * breakdown, preserving the historical ordering: types alphabetically,
 * states by descending document count.
 */
function reshapeFiscalRows(rows: FiscalDocumentGroupRow[]): {
  breakdownByType: Array<{
    documentType: string;
    count: number;
    totalAmount: Prisma.Decimal;
    states: Array<{ state: string; count: number }>;
  }>;
  totals: {
    documents: number;
    subtotal: Prisma.Decimal;
    tax: Prisma.Decimal;
    amount: Prisma.Decimal;
  };
} {
  const typeBuckets = new Map<
    string,
    {
      count: number;
      totalAmount: Prisma.Decimal;
      states: Array<{ state: string; count: number }>;
    }
  >();
  const totals = {
    documents: 0,
    subtotal: new Prisma.Decimal(0),
    tax: new Prisma.Decimal(0),
    amount: new Prisma.Decimal(0),
  };

  for (const row of rows) {
    totals.documents += row.count;
    totals.subtotal = totals.subtotal.plus(row.subtotal);
    totals.tax = totals.tax.plus(row.totalTax);
    totals.amount = totals.amount.plus(row.totalAmount);

    const type = row.documentType ?? 'UNKNOWN';
    const bucket = typeBuckets.get(type) ?? {
      count: 0,
      totalAmount: new Prisma.Decimal(0),
      states: [],
    };
    bucket.count += row.count;
    bucket.totalAmount = bucket.totalAmount.plus(row.totalAmount);
    bucket.states.push({
      state: row.fiscalState ?? 'UNKNOWN',
      count: row.count,
    });
    typeBuckets.set(type, bucket);
  }

  const breakdownByType = Array.from(typeBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([documentType, bucket]) => ({
      documentType,
      count: bucket.count,
      totalAmount: bucket.totalAmount,
      states: bucket.states.sort((a, s) => s.count - a.count),
    }));

  return { breakdownByType, totals };
}

/** Computes roll-up totals from the daily entries array. */
function computeDailyTotals(
  entries: Array<{
    salesCount: number;
    totalAmount: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    quantity: number;
    commissionAmount: Prisma.Decimal;
  }>,
): {
  totalSales: number;
  totalAmount: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalQuantity: number;
  totalCommission: Prisma.Decimal;
} {
  let totalSales = 0;
  let totalAmount = new Prisma.Decimal(0);
  let totalTax = new Prisma.Decimal(0);
  let totalQuantity = 0;
  let totalCommission = new Prisma.Decimal(0);

  for (const entry of entries) {
    totalSales += entry.salesCount;
    totalAmount = totalAmount.plus(entry.totalAmount);
    totalTax = totalTax.plus(entry.totalTax);
    totalQuantity += entry.quantity;
    totalCommission = totalCommission.plus(entry.commissionAmount);
  }

  return { totalSales, totalAmount, totalTax, totalQuantity, totalCommission };
}
