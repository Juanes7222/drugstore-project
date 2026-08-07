/**
 * Sales history service — read-only operational view of confirmed sales.
 *
 * Each confirmed local sale is paired with its immutable DIAN fiscal invoice(s).
 * The service resolves the "pharmacy view" by projecting local adjustments onto
 * the fiscal snapshot: payment methods, contact info, delivery notes, tags, and
 * the associated client can be overridden without changing what DIAN received.
 */

import { PrismaClient, SaleOperationalState } from '@pharmacy/database/local';
import type { Prisma } from '@pharmacy/database/local';
import type { SaleDeliveryInfo } from '@pharmacy/shared-types';
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
  /** Delivery fee in COP cents; 0 = not a domicilio or no fee. */
  deliveryFeeCents: number;
  /** Delivery address, when the sale is a domicilio. */
  deliveryAddress: string | null;
}

export interface SaleHistoryFilters {
  since?: Date;
  until?: Date;
  clientId?: string;
  /** Free-text search over local number, client name/ID, invoice number, status. */
  query?: string;
  /** Keyset pagination cursor (last row of the previous page). */
  cursor?: { id: string };
  limit?: number;
  offset?: number;
}

export interface SaleHistoryListResult {
  items: SaleHistoryListItem[];
  total: number;
}

/**
 * Lightweight invoice projection for the history grid.
 *
 * Produced by a single raw SQL query that extracts the buyer fallback from
 * the `fullData` JSONB payload via path expressions and counts the
 * adjustments in a correlated sub-query — none of the heavy fiscal columns
 * (`fullData`, `fiscalXml`) are ever materialized for the list.
 */
interface InvoiceSummaryRow {
  id: string;
  saleId: string;
  invoiceNumber: string;
  contingencyNumber: string | null;
  status: string;
  invoiceType: string;
  buyerName: string | null;
  buyerIdentificationNumber: string | null;
  adjustmentCount: number | null;
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
    /** Delivery (domicilio) info; null when the sale was in-store. */
    delivery: SaleDeliveryInfo | null;
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
    const query = filters.query?.trim();

    const where: Prisma.SaleWhereInput = {
      operationalState: SaleOperationalState.CONFIRMED,
    };

    if (filters.since || filters.until) {
      const confirmedAt: Prisma.DateTimeFilter = {};
      if (filters.since) confirmedAt.gte = filters.since;
      if (filters.until) confirmedAt.lte = filters.until;
      where.confirmedAt = confirmedAt;
    }

    if (filters.clientId) {
      where.clientId = filters.clientId;
    }

    if (query) {
      where.OR = await this.buildSearchWhere(query);
    }

    // Minimal projection — the list view never reads payments, and loading
    // them per row (JOIN + row materialization) is pure waste for the grid.
    // Keyset pagination (cursor on the unique sale id, ordered by confirmedAt)
    // replaces OFFSET so "load more" does not re-scan and discard rows.
    const [sales, total] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: [{ confirmedAt: 'desc' as const }, { id: 'desc' as const }],
        take: limit,
        ...(filters.cursor
          ? { skip: 1, cursor: { id: filters.cursor.id } }
          : { skip: offset }),
        select: {
          id: true,
          localNumber: true,
          startedAt: true,
          confirmedAt: true,
          totalAmount: true,
          clientNameSnapshot: true,
          clientIdentificationNumberSnapshot: true,
          delivery: true,
        },
      }),
      this.prisma.sale.count({ where }),
    ]);

    const saleIds = sales.map((s) => s.id);

    // Invoice summaries via a single raw query: only the columns the grid
    // renders, plus the buyer fallback extracted from the fullData JSONB via
    // a path expression (never materializing the whole payload) and the
    // adjustment count folded in as a correlated subquery.
    let invoicesBySaleId = new Map<string, InvoiceSummaryRow[]>();
    let adjustmentCountByInvoiceId = new Map<string, number>();
    if (saleIds.length > 0) {
      const placeholders = saleIds.map((_, i) => `$${i + 1}`).join(', ');
      const rows = await this.prisma.$queryRawUnsafe<InvoiceSummaryRow[]>(
        `SELECT i."id", i."saleId", i."invoiceNumber", i."contingencyNumber", i."status", i."invoiceType",
                i."fullData"->'buyer'->>'name' AS "buyerName",
                i."fullData"->'buyer'->>'identificationNumber' AS "buyerIdentificationNumber",
                (SELECT COUNT(*)::int
                   FROM "InvoiceLocalAdjustment" a
                  WHERE a."invoiceId" = i."id") AS "adjustmentCount"
           FROM "Invoice" i
          WHERE i."saleId" IN (${placeholders})
          ORDER BY i."issuedAt" DESC`,
        ...saleIds,
      );

      invoicesBySaleId = new Map<string, InvoiceSummaryRow[]>();
      adjustmentCountByInvoiceId = new Map<string, number>();
      for (const row of rows) {
        const list = invoicesBySaleId.get(row.saleId) ?? [];
        list.push(row);
        invoicesBySaleId.set(row.saleId, list);
        if (!adjustmentCountByInvoiceId.has(row.id)) {
          adjustmentCountByInvoiceId.set(row.id, row.adjustmentCount ?? 0);
        }
      }
    }

    const items: SaleHistoryListItem[] = sales.map((sale) => {
      const saleInvoices = invoicesBySaleId.get(sale.id) ?? [];
      const mainInvoice = saleInvoices[0] ?? null;
      const delivery = deliveryFromJson(sale.delivery);

      return {
        saleId: sale.id,
        localNumber: String(sale.localNumber),
        confirmedAt: sale.confirmedAt?.toISOString() ?? sale.startedAt.toISOString(),
        totalAmount: sale.totalAmount.toString(),
        clientName:
          sale.clientNameSnapshot ??
          mainInvoice?.buyerName ??
          'CONSUMIDOR FINAL',
        clientIdentificationNumber:
          sale.clientIdentificationNumberSnapshot ??
          mainInvoice?.buyerIdentificationNumber ??
          null,
        invoiceId: mainInvoice?.id ?? null,
        invoiceNumber: mainInvoice?.invoiceNumber ?? mainInvoice?.contingencyNumber ?? null,
        invoiceStatus: mainInvoice?.status ?? null,
        invoiceType: mainInvoice?.invoiceType ?? null,
        hasAdjustments: mainInvoice
          ? (adjustmentCountByInvoiceId.get(mainInvoice.id) ?? 0) > 0
          : false,
        deliveryFeeCents: delivery?.feeCents ?? 0,
        deliveryAddress: delivery?.address ?? null,
      };
    });

    return { items, total };
  }

  /**
   * Build the search OR-clause. Free-text over client name/ID is a plain
   * Prisma contains filter; substring matches over the numeric local number
   * and the invoice number/status need SQL casts/sub-queries, so the matching
   * sale ids are resolved first with targeted raw queries.
   */
  private async buildSearchWhere(query: string): Promise<Prisma.SaleWhereInput[]> {
    const or: Prisma.SaleWhereInput[] = [
      { clientNameSnapshot: { contains: query, mode: 'insensitive' } },
      { clientIdentificationNumberSnapshot: { contains: query, mode: 'insensitive' } },
    ];

    const saleIds: string[] = [];

    // Substring match on the numeric local number (cast to text in SQL).
    if (/^\d+$/.test(query)) {
      const rows = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT "id" FROM "Sale" WHERE "localNumber"::text LIKE $1`,
        `%${query}%`,
      );
      saleIds.push(...rows.map((r) => r.id));
    }

    // Substring match on invoice number / fiscal status. `status` is an enum
    // column, so it must be cast to text before ILIKE (PG has no operator for
    // ILIKE on enum types).
    const invoiceRows = await this.prisma.$queryRawUnsafe<Array<{ saleId: string }>>(
      `SELECT "saleId" FROM "Invoice" WHERE "invoiceNumber" ILIKE $1 OR "status"::text ILIKE $1`,
      `%${query}%`,
    );
    saleIds.push(...invoiceRows.map((r) => r.saleId));

    if (saleIds.length > 0) {
      or.push({ id: { in: [...new Set(saleIds)] } });
    }

    return or;
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
        delivery: deliveryFromJson(sale.delivery),
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

/**
 * Parse a `Sale.delivery` JSON column value into the typed delivery info.
 * Null, malformed, or missing-typed fields → null (in-store sale).
 */
function deliveryFromJson(value: Prisma.JsonValue | null): SaleDeliveryInfo | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const parsed = value as Record<string, unknown>;
  if (typeof parsed.state !== 'string') {
    return null;
  }
  const feeCents = typeof parsed.feeCents === 'number' ? Math.max(0, Math.round(parsed.feeCents)) : 0;
  return {
    state: parsed.state as SaleDeliveryInfo['state'],
    address: typeof parsed.address === 'string' ? parsed.address : null,
    contactName: typeof parsed.contactName === 'string' ? parsed.contactName : null,
    contactPhone: typeof parsed.contactPhone === 'string' ? parsed.contactPhone : null,
    notes: typeof parsed.notes === 'string' ? parsed.notes : null,
    scheduledAt: typeof parsed.scheduledAt === 'string' ? parsed.scheduledAt : null,
    feeCents,
  };
}
