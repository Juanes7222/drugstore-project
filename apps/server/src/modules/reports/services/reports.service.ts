import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma } from '@pharmacy/database';
import { ReportDateRangeQueryDto } from '../dto/report-date-range.query.dto';
import { ReportInvalidDateRangeException } from '../exceptions/report-invalid-date-range.exception';
import { SaleType } from '@pharmacy/shared-types';

/** Number of days from the valuation date beyond which a lot is not considered expiring soon. */
const EXPIRING_SOON_DAYS = 90;

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
    const sales = await this.fetchConfirmedSales(query);
    const breakdown = buildSalesBreakdown(sales);
    const totals = computeSalesTotals(sales);
    return {
      totalSales: totals.totalSales.toFixed(2),
      totalQuantity: totals.totalQuantity,
      breakdownBySaleType: formatBreakdownEntries(breakdown),
    };
  }

  /**
   * Aggregates closed CashShift rows within the date range and their associated
   * SalePayment amounts grouped by payment method category.
   */
  async getCashShiftSummary(query: ReportDateRangeQueryDto): Promise<any> {
    assertValidDateRange(query.dateFrom, query.dateTo);
    const shifts = await this.fetchClosedShifts(query);
    const totalCashMovement = shifts.reduce(
      (sum: Prisma.Decimal, s: any) => sum.plus(s.expectedClosingAmount ?? 0),
      new Prisma.Decimal(0),
    );
    const payments = await this.fetchShiftPayments(shifts.map((s: any) => s.id));
    return {
      totalShifts: shifts.length,
      totalCashMovement: totalCashMovement.toFixed(2),
      breakdownByPaymentMethod: formatPaymentEntries(payments),
    };
  }

  /**
   * Values every Lot with currentStock > 0 as of asOfDate (taken from
   * query.dateFrom). Lots without a PurchaseReceptionItem record are counted
   * in `lotsWithUnknownCost` and excluded from the monetary total; they still
   * contribute to lot counts.
   */
  async getInventoryValuation(query: ReportDateRangeQueryDto): Promise<any> {
    assertValidDateRange(query.dateFrom, query.dateTo);
    const asOfDate = new Date(query.dateFrom);
    const lots = await this.prisma.lot.findMany({
      where: { currentStock: { gt: 0 } },
      include: {
        product: { select: { id: true, commercialName: true } },
        purchaseReceptionItems: { select: { realUnitCost: true }, orderBy: { id: 'asc' }, take: 1 },
      },
    });
    const valuation = computeLotValuation(lots, expiryThreshold(asOfDate));
    return { valuationDate: asOfDate.toISOString(), ...valuation };
  }

  /**
   * Aggregates subtotal and taxAmount for items belonging to CONFIRMED sales
   * whose VALIDATED INVOICE fiscal document has updatedAt (proxy for validatedAt)
   * within the requested range, grouped by the stored taxRate.
   *
   * Important: This report counts VALIDATED INVOICEs but does NOT net out
   * CREDIT_NOTEs issued against those same sales in the same period.  Proper
   * credit-note netting is deferred to a later refinement.
   */
  async getTaxSummary(query: ReportDateRangeQueryDto): Promise<any> {
    assertValidDateRange(query.dateFrom, query.dateTo);

    const dateFrom = new Date(query.dateFrom);
    const dateTo = new Date(query.dateTo);

    const fiscalDocs = await this.fetchTaxSummaryFiscalDocs(dateFrom, dateTo);
    const { breakdown, totalDocuments } = aggregateByTaxRate(fiscalDocs);

    const totalTaxableBase = breakdown.reduce(
      (sum, b) => sum.plus(b.taxableBase), new Prisma.Decimal(0),
    );
    const totalTaxAmount = breakdown.reduce(
      (sum, b) => sum.plus(b.taxAmount), new Prisma.Decimal(0),
    );

    return {
      reportPeriod: { dateFrom: query.dateFrom, dateTo: query.dateTo },
      totalDocuments,
      totalTaxableBase: totalTaxableBase.toFixed(2),
      totalTaxAmount: totalTaxAmount.toFixed(2),
      breakdownByTaxRate: breakdown.map((b) => ({
        taxRate: b.taxRate,
        taxableBase: b.taxableBase.toFixed(2),
        taxAmount: b.taxAmount.toFixed(2),
        documentCount: b.documentCount,
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

    const dateFrom = new Date(query.dateFrom);
    const dateTo = new Date(query.dateTo);

    const docs = await this.fetchFiscalDocuments(dateFrom, dateTo);
    const { breakdownByType, totalSubtotal, totalTax, totalAmount, totalDocuments } =
      aggregateFiscalDocuments(docs);

    return {
      reportPeriod: { dateFrom: query.dateFrom, dateTo: query.dateTo },
      view: query.view,
      totalDocuments,
      totalSubtotal: totalSubtotal.toFixed(2),
      totalTax: totalTax.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      breakdownByType: breakdownByType.map((b) => ({
        documentType: b.documentType,
        count: b.count,
        totalAmount: b.totalAmount.toFixed(2),
        states: b.states.map((s) => ({ state: s.state, count: s.count })),
      })),
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

    const dateFrom = new Date(query.dateFrom);
    const dateTo = new Date(query.dateTo);

    const sales = await this.fetchConfirmedSalesForDaily(dateFrom, dateTo);
    const dailyEntries = aggregateDailySales(sales);
    const totals = computeDailyTotals(dailyEntries);

    return {
      reportPeriod: { dateFrom: query.dateFrom, dateTo: query.dateTo },
      view: query.view,
      totalDays: dailyEntries.length,
      totals: {
        totalSales: totals.totalSales,
        totalAmount: totals.totalAmount.toFixed(2),
        totalTax: totals.totalTax.toFixed(2),
        totalQuantity: totals.totalQuantity,
        averageTicket: totals.totalSales > 0
          ? totals.totalAmount.dividedBy(totals.totalSales).toFixed(2)
          : '0.00',
      },
      dailyEntries: dailyEntries.map((d) => ({
        date: d.date,
        salesCount: d.salesCount,
        totalAmount: d.totalAmount.toFixed(2),
        totalTax: d.totalTax.toFixed(2),
        quantity: d.quantity,
        averageTicket: d.salesCount > 0
          ? d.totalAmount.dividedBy(d.salesCount).toFixed(2)
          : '0.00',
      })),
    };
  }

  // ── Private database-access helpers ──────────────────────────────

  private async fetchConfirmedSales(query: ReportDateRangeQueryDto): Promise<any[]> {
    return this.prisma.sale.findMany({
      where: {
        operationalState: 'CONFIRMED',
        confirmedAt: { gte: new Date(query.dateFrom), lte: new Date(query.dateTo) },
      },
      include: { items: { include: { product: { select: { saleType: true } } } } },
    });
  }

  private async fetchClosedShifts(query: ReportDateRangeQueryDto): Promise<any[]> {
    return this.prisma.cashShift.findMany({
      where: {
        closedAt: { gte: new Date(query.dateFrom), lte: new Date(query.dateTo) },
        state: 'CLOSED',
      },
      select: { id: true, expectedClosingAmount: true },
    });
  }

  private async fetchShiftPayments(shiftIds: string[]): Promise<any[]> {
    return this.prisma.sale.findMany({
      where: { cashShiftId: { in: shiftIds }, operationalState: 'CONFIRMED' },
      include: { payments: { include: { paymentMethod: { select: { category: true } } } } },
    });
  }

  /**
   * Returns validated INVOICE fiscal documents (with their Sale items) whose
   * updatedAt falls within [dateFrom, dateTo].
   *
   * Note: The schema has no validatedAt column, so updatedAt is the closest
   * proxy for when the document reached VALIDATED state.
   */
  private async fetchTaxSummaryFiscalDocs(dateFrom: Date, dateTo: Date): Promise<any[]> {
    return this.prisma.fiscalDocument.findMany({
      where: {
        documentType: 'INVOICE',
        fiscalState: 'VALIDATED',
        updatedAt: { gte: dateFrom, lte: dateTo },
        sale: { operationalState: 'CONFIRMED' },
      },
      select: {
        id: true,
        sale: {
          select: {
            items: {
              select: {
                taxRate: true,
                subtotal: true,
                taxAmount: true,
              },
            },
          },
        },
      },
    });
  }

  /**
   * Returns all fiscal documents whose issueDate falls within [dateFrom, dateTo],
   * with aggregated totals at the document level.
   */
  private async fetchFiscalDocuments(dateFrom: Date, dateTo: Date): Promise<any[]> {
    return this.prisma.fiscalDocument.findMany({
      where: {
        issueDate: { gte: dateFrom, lte: dateTo },
      },
      select: {
        id: true,
        documentType: true,
        fiscalState: true,
        subtotal: true,
        totalTax: true,
        totalAmount: true,
      },
    });
  }

  /**
   * Returns CONFIRMED sales whose confirmedAt falls within [dateFrom, dateTo],
   * with item-level detail needed for daily aggregation.
   */
  private async fetchConfirmedSalesForDaily(dateFrom: Date, dateTo: Date): Promise<any[]> {
    return this.prisma.sale.findMany({
      where: {
        operationalState: 'CONFIRMED',
        confirmedAt: { gte: dateFrom, lte: dateTo },
      },
      select: {
        id: true,
        confirmedAt: true,
        totalAmount: true,
        totalTax: true,
        items: {
          select: {
            quantity: true,
          },
        },
      },
      orderBy: { confirmedAt: 'asc' },
    });
  }
}

// ── Module-level pure computation helpers ──────────────────────────

function assertValidDateRange(dateFrom: string, dateTo: string): void {
  if (new Date(dateFrom) > new Date(dateTo)) {
    throw new ReportInvalidDateRangeException(dateFrom, dateTo);
  }
}

function expiryThreshold(from: Date): Date {
  const t = new Date(from);
  t.setDate(t.getDate() + EXPIRING_SOON_DAYS);
  return t;
}

function buildSalesBreakdown(
  sales: any[],
): Map<string, { saleType: string; count: number; totalAmount: Prisma.Decimal }> {
  const map = new Map<string, { saleType: string; count: number; totalAmount: Prisma.Decimal }>();
  for (const sale of sales) {
    for (const item of sale.items ?? []) {
      const st = item.product?.saleType ?? SaleType.FREE_SALE;
      const entry = map.get(st) ?? { saleType: st, count: 0, totalAmount: new Prisma.Decimal(0) };
      entry.count += 1;
      entry.totalAmount = entry.totalAmount.plus(item.total ?? 0);
      map.set(st, entry);
    }
  }
  return map;
}

function computeSalesTotals(sales: any[]): { totalSales: Prisma.Decimal; totalQuantity: number } {
  let totalSales = new Prisma.Decimal(0);
  let totalQuantity = 0;
  for (const sale of sales) {
    totalSales = totalSales.plus(sale.totalAmount ?? 0);
    for (const item of sale.items ?? []) {
      totalQuantity += item.quantity ?? 0;
    }
  }
  return { totalSales, totalQuantity };
}

function formatBreakdownEntries(
  map: Map<string, { saleType: string; count: number; totalAmount: Prisma.Decimal }>,
): any[] {
  return Array.from(map.values()).map((e) => ({
    saleType: e.saleType,
    count: e.count,
    totalAmount: e.totalAmount.toFixed(2),
    averageAmount: e.count > 0 ? e.totalAmount.dividedBy(e.count).toFixed(2) : '0.00',
  }));
}

function formatPaymentEntries(sales: any[]): any[] {
  const map = new Map<string, { category: string; count: number; totalAmount: Prisma.Decimal }>();
  for (const sale of sales) {
    for (const payment of sale.payments ?? []) {
      const cat = payment.paymentMethod?.category ?? 'OTHER';
      const entry = map.get(cat) ?? { category: cat, count: 0, totalAmount: new Prisma.Decimal(0) };
      entry.count += 1;
      entry.totalAmount = entry.totalAmount.plus(payment.amount ?? 0);
      map.set(cat, entry);
    }
  }
  return Array.from(map.values()).map((e) => ({
    paymentMethodCategory: e.category,
    count: e.count,
    totalAmount: e.totalAmount.toFixed(2),
    averageAmount: e.count > 0 ? e.totalAmount.dividedBy(e.count).toFixed(2) : '0.00',
  }));
}

/**
 * Aggregates SaleItem subtotal and taxAmount from validated INVOICE fiscal
 * documents, grouped by the stored taxRate at the time of sale.
 *
 * Important: This function counts VALIDATED INVOICEs but does not net out
 * CREDIT_NOTEs issued against the same sales — that is deferred to a later
 * refinement.
 *
 * The function is kept as a single block because splitting it would force
 * jumping across helper-only sub-steps that make the aggregation flow
 * harder to read.
 */
function aggregateByTaxRate(
  fiscalDocs: any[],
): { breakdown: Array<{ taxRate: string; taxableBase: Prisma.Decimal; taxAmount: Prisma.Decimal; documentCount: number }>; totalDocuments: number } {
  const rateBuckets = new Map<string, { taxableBase: Prisma.Decimal; taxAmount: Prisma.Decimal; documentIds: Set<string> }>();
  let totalDocuments = 0;

  for (const fd of fiscalDocs) {
    totalDocuments++;
    const sale = fd.sale;
    if (!sale?.items) continue;
    for (const item of sale.items) {
      const rateKey = item.taxRate.toFixed(4);
      let bucket = rateBuckets.get(rateKey);
      if (!bucket) {
        bucket = { taxableBase: new Prisma.Decimal(0), taxAmount: new Prisma.Decimal(0), documentIds: new Set<string>() };
        rateBuckets.set(rateKey, bucket);
      }
      bucket.taxableBase = bucket.taxableBase.plus(item.subtotal ?? 0);
      bucket.taxAmount = bucket.taxAmount.plus(item.taxAmount ?? 0);
      bucket.documentIds.add(fd.id);
    }
  }

  const breakdown = Array.from(rateBuckets.entries())
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([taxRate, bucket]) => ({
      taxRate,
      taxableBase: bucket.taxableBase,
      taxAmount: bucket.taxAmount,
      documentCount: bucket.documentIds.size,
    }));

  return { breakdown, totalDocuments };
}

function computeLotValuation(lots: any[], threshold: Date) {
  const agg = aggregateLots(lots, threshold);
  const totalValue = Array.from(agg.productMap.values()).reduce(
    (sum: any, e: any) => sum.plus(e.value), new Prisma.Decimal(0),
  );
  return {
    totalLotsActive: agg.active,
    totalLotsExpiring: agg.expiring,
    lotsWithUnknownCost: agg.unknownCost,
    totalInventoryValue: totalValue.toFixed(2),
    breakdownByProduct: formatProductEntries(agg.productMap),
  };
}

/** Single-pass lot aggregation: builds the per-product map and counts lot-level stats. */
function aggregateLots(lots: any[], threshold: Date) {
  let active = 0, expiring = 0, unknownCost = 0;
  const productMap = new Map<string, any>();

  for (const lot of lots) {
    active++;
    if (lot.expirationDate <= threshold) expiring++;
    const pri = lot.purchaseReceptionItems?.[0];
    if (!pri) unknownCost++;
    const cost = pri ? new Prisma.Decimal(pri.realUnitCost ?? 0) : new Prisma.Decimal(0);
    const lotVal = cost.times(lot.currentStock ?? 0);
    const pid = lot.product?.id;
    const entry = productMap.get(pid) ?? { pid, name: lot.product?.commercialName ?? 'Unknown', qty: 0, value: new Prisma.Decimal(0), expCount: 0 };
    entry.qty += lot.currentStock ?? 0;
    entry.value = entry.value.plus(lotVal);
    if (lot.expirationDate <= threshold) entry.expCount++;
    productMap.set(pid, entry);
  }
  return { active, expiring, unknownCost, productMap };
}

/** Formats the per-product map into the response breakdown array. */
function formatProductEntries(productMap: Map<string, any>): any[] {
  return Array.from(productMap.values()).map((e) => ({
    productId: e.pid,
    productName: e.name,
    quantity: e.qty,
    unitCost: e.qty > 0 ? e.value.dividedBy(e.qty).toFixed(2) : '0.00',
    totalValue: e.value.toFixed(2),
    expiringLotCount: e.expCount,
  }));
}

// ── Fiscal report aggregation ─────────────────────────────────

/**
 * Aggregates fiscal documents by document type and fiscal state.
 *
 * Kept as a single block because splitting across helper-only sub-steps
 * would make the two-level grouping flow harder to follow.
 */
function aggregateFiscalDocuments(
  docs: any[],
): {
  breakdownByType: Array<{
    documentType: string;
    count: number;
    totalAmount: Prisma.Decimal;
    states: Array<{ state: string; count: number }>;
  }>;
  totalSubtotal: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  totalDocuments: number;
} {
  const typeBuckets = new Map<string, {
    documentType: string;
    count: number;
    totalAmount: Prisma.Decimal;
    stateBuckets: Map<string, { state: string; count: number }>;
  }>();

  let totalSubtotal = new Prisma.Decimal(0);
  let totalTax = new Prisma.Decimal(0);
  let totalAmount = new Prisma.Decimal(0);
  let totalDocuments = 0;

  for (const doc of docs) {
    totalDocuments++;
    totalSubtotal = totalSubtotal.plus(doc.subtotal ?? 0);
    totalTax = totalTax.plus(doc.totalTax ?? 0);
    totalAmount = totalAmount.plus(doc.totalAmount ?? 0);

    const type = doc.documentType ?? 'UNKNOWN';
    let bucket = typeBuckets.get(type);
    if (!bucket) {
      bucket = {
        documentType: type,
        count: 0,
        totalAmount: new Prisma.Decimal(0),
        stateBuckets: new Map(),
      };
      typeBuckets.set(type, bucket);
    }
    bucket.count++;
    bucket.totalAmount = bucket.totalAmount.plus(doc.totalAmount ?? 0);

    const state = doc.fiscalState ?? 'UNKNOWN';
    let stateBucket = bucket.stateBuckets.get(state);
    if (!stateBucket) {
      stateBucket = { state, count: 0 };
      bucket.stateBuckets.set(state, stateBucket);
    }
    stateBucket.count++;
  }

  const breakdownByType = Array.from(typeBuckets.values())
    .sort((a, b) => a.documentType.localeCompare(b.documentType))
    .map((b) => ({
      documentType: b.documentType,
      count: b.count,
      totalAmount: b.totalAmount,
      states: Array.from(b.stateBuckets.values())
        .sort((a, s) => s.count - a.count),
    }));

  return { breakdownByType, totalSubtotal, totalTax, totalAmount, totalDocuments };
}

// ── Daily report aggregation ───────────────────────────────────

/** Groups CONFIRMED sales by calendar day (YYYY-MM-DD). */
function aggregateDailySales(
  sales: any[],
): Array<{
  date: string;
  salesCount: number;
  totalAmount: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  quantity: number;
}> {
  const dayMap = new Map<string, {
    salesCount: number;
    totalAmount: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    quantity: number;
  }>();

  for (const sale of sales) {
    if (!sale.confirmedAt) continue;
    const dateKey = toDateString(sale.confirmedAt);
    let entry = dayMap.get(dateKey);
    if (!entry) {
      entry = {
        salesCount: 0,
        totalAmount: new Prisma.Decimal(0),
        totalTax: new Prisma.Decimal(0),
        quantity: 0,
      };
      dayMap.set(dateKey, entry);
    }
    entry.salesCount++;
    entry.totalAmount = entry.totalAmount.plus(sale.totalAmount ?? 0);
    entry.totalTax = entry.totalTax.plus(sale.totalTax ?? 0);
    for (const item of sale.items ?? []) {
      entry.quantity += item.quantity ?? 0;
    }
  }

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entry]) => ({ date, ...entry }));
}

/** Computes roll-up totals from the daily entries array. */
function computeDailyTotals(
  entries: Array<{
    salesCount: number;
    totalAmount: Prisma.Decimal;
    totalTax: Prisma.Decimal;
    quantity: number;
  }>,
): {
  totalSales: number;
  totalAmount: Prisma.Decimal;
  totalTax: Prisma.Decimal;
  totalQuantity: number;
} {
  let totalSales = 0;
  let totalAmount = new Prisma.Decimal(0);
  let totalTax = new Prisma.Decimal(0);
  let totalQuantity = 0;

  for (const entry of entries) {
    totalSales += entry.salesCount;
    totalAmount = totalAmount.plus(entry.totalAmount);
    totalTax = totalTax.plus(entry.totalTax);
    totalQuantity += entry.quantity;
  }

  return { totalSales, totalAmount, totalTax, totalQuantity };
}

/** Formats a Date or ISO string as YYYY-MM-DD. */
function toDateString(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
