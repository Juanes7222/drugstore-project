import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { Prisma } from '@prisma/client';
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
    const lots = await (this.prisma.lot as any).findMany({
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

  // ── Private database-access helpers ──────────────────────────────

  private async fetchConfirmedSales(query: ReportDateRangeQueryDto): Promise<any[]> {
    return (this.prisma.sale as any).findMany({
      where: {
        operationalState: 'CONFIRMED',
        confirmedAt: { gte: new Date(query.dateFrom), lte: new Date(query.dateTo) },
      },
      include: { items: { include: { product: { select: { saleType: true } } } } },
    });
  }

  private async fetchClosedShifts(query: ReportDateRangeQueryDto): Promise<any[]> {
    return (this.prisma.cashShift as any).findMany({
      where: {
        closedAt: { gte: new Date(query.dateFrom), lte: new Date(query.dateTo) },
        state: 'CLOSED',
      },
      select: { id: true, expectedClosingAmount: true },
    });
  }

  private async fetchShiftPayments(shiftIds: string[]): Promise<any[]> {
    return (this.prisma.sale as any).findMany({
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
    return (this.prisma.fiscalDocument as any).findMany({
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
