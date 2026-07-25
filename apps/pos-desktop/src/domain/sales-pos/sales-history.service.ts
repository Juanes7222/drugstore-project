/**
 * Sales history service — read-only operational view of confirmed sales.
 *
 * Each confirmed local sale is paired with its immutable DIAN fiscal invoice(s).
 * The service resolves the "pharmacy view" by projecting local adjustments onto
 * the fiscal snapshot: payment methods, contact info, delivery notes, tags, and
 * the associated client can be overridden without changing what DIAN received.
 */

import { PrismaClient, SaleOperationalState } from '@pharmacy/database/local';
import type { InvoiceModel } from '../fiscal/fiscal-types';
import type { LocalAdjustmentService } from '../fiscal/local-adjustment.service';
import type {
  OperationalInvoiceView,
  AdjustmentHistoryEntry,
} from '../fiscal/local-adjustment.types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SaleHistoryListItem {
  saleId: string;
  localNumber: string;
  confirmedAt: string;
  totalAmount: string;
  clientName: string;
  clientIdentificationNumber: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  invoiceType: string | null;
  hasAdjustments: boolean;
}

export interface SaleHistoryFilters {
  since?: Date;
  until?: Date;
  clientId?: string;
  limit?: number;
  offset?: number;
}

export interface SaleHistoryListResult {
  items: SaleHistoryListItem[];
  total: number;
}

export interface SaleHistoryPayment {
  id: string;
  paymentMethodId: string;
  paymentMethodName: string;
  amount: string;
  transactionReference: string | null;
  authorizationCode: string | null;
  cardBrand: string | null;
  cardLastFour: string | null;
}

export interface SaleHistoryItem {
  id: string;
  productId: string;
  internalCode: string;
  commercialName: string;
  genericName: string | null;
  concentration: string | null;
  quantity: number;
  unitPrice: string;
  discountPercentage: string;
  discountAmount: string;
  discountReason: string | null;
  taxRate: string;
  taxAmount: string;
  subtotal: string;
  total: string;
}

export interface SaleHistoryDetail {
  sale: {
    id: string;
    localNumber: string;
    confirmedAt: string;
    subtotal: string;
    totalDiscount: string;
    totalTax: string;
    totalAmount: string;
    changeAmount: string;
    clientId: string | null;
    clientNameSnapshot: string | null;
    clientIdentificationTypeSnapshot: string | null;
    clientIdentificationNumberSnapshot: string | null;
    cashShiftId: string;
    workstationId: string;
    userId: string;
    items: SaleHistoryItem[];
    payments: SaleHistoryPayment[];
  };
  invoices: InvoiceModel[];
  mainInvoiceOperationalView: OperationalInvoiceView | null;
  adjustmentHistory: AdjustmentHistoryEntry[];
}

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface SalesHistoryService {
  listConfirmedSales(filters?: SaleHistoryFilters): Promise<SaleHistoryListResult>;
  getSaleHistoryDetail(saleId: string): Promise<SaleHistoryDetail | null>;
}

export interface SalesHistoryServiceConfig {
  prisma: PrismaClient;
  adjustmentService: LocalAdjustmentService;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSalesHistoryService = (
  config: SalesHistoryServiceConfig,
): SalesHistoryService => {
  return new SalesHistoryServiceImpl(config.prisma, config.adjustmentService);
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SalesHistoryServiceImpl implements SalesHistoryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly adjustmentService: LocalAdjustmentService,
  ) {}

  async listConfirmedSales(filters: SaleHistoryFilters = {}): Promise<SaleHistoryListResult> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const where: Record<string, unknown> = {
      operationalState: SaleOperationalState.CONFIRMED,
    };

    if (filters.since || filters.until) {
      const confirmedAt: Record<string, Date> = {};
      if (filters.since) confirmedAt.gte = filters.since;
      if (filters.until) confirmedAt.lte = filters.until;
      where.confirmedAt = confirmedAt;
    }

    if (filters.clientId) {
      where.clientId = filters.clientId;
    }

    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { confirmedAt: 'desc' as const },
        take: limit,
        skip: offset,
        include: {
          payments: { include: { paymentMethod: { select: { name: true } } } },
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    const saleIds = sales.map((s) => s.id);
    const invoices = await this.prisma.invoice.findMany({
      where: { saleId: { in: saleIds } },
      orderBy: { issuedAt: 'desc' as const },
    });

    const adjustmentCounts = await this.prisma.invoiceLocalAdjustment.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: invoices.map((i) => i.id) } },
      _count: { invoiceId: true },
    });

    const invoicesBySaleId = new Map<string, (typeof invoices)[number][]>();
    for (const invoice of invoices) {
      const list = invoicesBySaleId.get(invoice.saleId) ?? [];
      list.push(invoice);
      invoicesBySaleId.set(invoice.saleId, list);
    }

    const adjustmentCountByInvoiceId = new Map(
      adjustmentCounts.map((ac) => [ac.invoiceId, ac._count.invoiceId]),
    );

    const items: SaleHistoryListItem[] = sales.map((sale) => {
      const saleInvoices = invoicesBySaleId.get(sale.id) ?? [];
      const mainInvoice = saleInvoices[0] ?? null;
      const fullData = mainInvoice?.fullData as Record<string, unknown> | undefined;
      const buyer = (fullData?.buyer ?? {}) as Record<string, unknown>;

      return {
        saleId: sale.id,
        localNumber: sale.localNumber.toString(),
        confirmedAt: sale.confirmedAt?.toISOString() ?? sale.startedAt.toISOString(),
        totalAmount: sale.totalAmount.toString(),
        clientName:
          sale.clientNameSnapshot ??
          (typeof buyer.name === 'string' ? buyer.name : 'CONSUMIDOR FINAL'),
        clientIdentificationNumber:
          sale.clientIdentificationNumberSnapshot ??
          (typeof buyer.identificationNumber === 'string'
            ? buyer.identificationNumber
            : null),
        invoiceId: mainInvoice?.id ?? null,
        invoiceNumber: mainInvoice?.invoiceNumber ?? mainInvoice?.contingencyNumber ?? null,
        invoiceStatus: mainInvoice?.status ?? null,
        invoiceType: mainInvoice?.invoiceType ?? null,
        hasAdjustments: mainInvoice
          ? (adjustmentCountByInvoiceId.get(mainInvoice.id) ?? 0) > 0
          : false,
      };
    });

    return { items, total };
  }

  async getSaleHistoryDetail(saleId: string): Promise<SaleHistoryDetail | null> {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        items: true,
        payments: {
          include: { paymentMethod: { select: { name: true, category: true } } },
        },
      },
    });

    if (!sale) return null;

    const invoices = await this.prisma.invoice.findMany({
      where: { saleId },
      orderBy: { issuedAt: 'desc' as const },
    });

    const mainInvoice = invoices[0] ?? null;

    let mainInvoiceOperationalView: OperationalInvoiceView | null = null;
    let adjustmentHistory: AdjustmentHistoryEntry[] = [];

    if (mainInvoice) {
      [mainInvoiceOperationalView, adjustmentHistory] = await Promise.all([
        this.adjustmentService.resolveOperationalView(mainInvoice.id),
        this.adjustmentService.getAdjustmentHistory(mainInvoice.id),
      ]);
    }

    return {
      sale: {
        id: sale.id,
        localNumber: sale.localNumber.toString(),
        confirmedAt: sale.confirmedAt?.toISOString() ?? sale.startedAt.toISOString(),
        subtotal: sale.subtotal.toString(),
        totalDiscount: sale.totalDiscount.toString(),
        totalTax: sale.totalTax.toString(),
        totalAmount: sale.totalAmount.toString(),
        changeAmount: sale.changeAmount.toString(),
        clientId: sale.clientId,
        clientNameSnapshot: sale.clientNameSnapshot,
        clientIdentificationTypeSnapshot: sale.clientIdentificationTypeSnapshot,
        clientIdentificationNumberSnapshot: sale.clientIdentificationNumberSnapshot,
        cashShiftId: sale.cashShiftId,
        workstationId: sale.workstationId,
        userId: sale.userId,
        items: sale.items.map((item) => ({
          id: item.id,
          productId: item.productId,
          internalCode: item.productInternalCodeSnapshot,
          commercialName: item.productCommercialNameSnapshot,
          genericName: item.productGenericNameSnapshot,
          concentration: item.productConcentrationSnapshot,
          quantity: item.quantity,
          unitPrice: item.unitPrice.toString(),
          discountPercentage: item.discountPercentage.toString(),
          discountAmount: item.discountAmount.toString(),
          discountReason: item.discountReason,
          taxRate: item.taxRate.toString(),
          taxAmount: item.taxAmount.toString(),
          subtotal: item.subtotal.toString(),
          total: item.total.toString(),
        })),
        payments: sale.payments.map((p) => ({
          id: p.id,
          paymentMethodId: p.paymentMethodId,
          paymentMethodName: p.paymentMethod?.name ?? 'Unknown',
          amount: p.amount.toString(),
          transactionReference: p.transactionReference ?? null,
          authorizationCode: p.authorizationCode ?? null,
          cardBrand: p.cardBrand ?? null,
          cardLastFour: p.cardLastFour ?? null,
        })),
      },
      invoices: invoices.map((inv) => inv as unknown as InvoiceModel),
      mainInvoiceOperationalView,
      adjustmentHistory,
    };
  }
}
