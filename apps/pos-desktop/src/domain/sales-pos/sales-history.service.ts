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
  workstationId?: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createSalesHistoryService = (
  config: SalesHistoryServiceConfig,
): SalesHistoryService => {
  return new SalesHistoryServiceImpl(config.prisma, config.adjustmentService, config.workstationId);
};

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class SalesHistoryServiceImpl implements SalesHistoryService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly adjustmentService: LocalAdjustmentService,
    private readonly workstationId?: string,
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
          sourceOperationUuid: true,
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

    // Include pending LAN sales from other workstations that have been
    // adopted into SyncQueue but whose Sale row hasn't been pulled from
    // the server yet. This makes the "historial" immediate across LAN
    // without waiting for the 5-minute server sync.
    try {
      const pendingLanItems = await this.fetchPendingLanSalesAsHistoryItems(filters);
      if (pendingLanItems.length > 0) {
        // A pending LAN item is keyed by origin localSaleId (or the queue
        // operationUuid for legacy payloads without metadata). It duplicates
        // a Sale row when the row carries the same id (server preserves the
        // origin id) or the same sourceOperationUuid (server-assigned id
        // after replay). One set covers both linkages — a previous revision
        // built two identical id sets here, so uuid-keyed ghosts were never
        // filtered and rendered next to their own Sale row.
        const knownSaleKeys = new Set<string>();
        for (const s of sales) {
          knownSaleKeys.add(s.id);
          if (s.sourceOperationUuid) knownSaleKeys.add(s.sourceOperationUuid);
        }
        for (const p of pendingLanItems) {
          if (!knownSaleKeys.has(p.saleId)) {
            items.push(p);
          }
        }
        items.sort((a, b) => new Date(b.confirmedAt).getTime() - new Date(a.confirmedAt).getTime());
        // Re-apply limit/offset after merge for consistent pagination
        const paged = items.slice(offset, offset + limit);
        return { items: paged, total: items.length };
      }
    } catch {
      // Best-effort — never break the main query if SyncQueue parsing fails
    }

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

  private async fetchPendingLanSalesAsHistoryItems(
    filters: SaleHistoryFilters,
  ): Promise<SaleHistoryListItem[]> {
    // Only show foreign workstation sales that are pending in SyncQueue
    const rows = await this.prisma.syncQueue.findMany({
      where: {
        operationType: 'SALE_CONFIRMATION',
        status: { in: ['PENDING', 'FAILED'] },
        ...(this.workstationId ? { sourceWorkstationId: { not: this.workstationId } } : {}),
      },
      orderBy: { sourceCreatedAt: 'desc' },
      take: 100,
    });

    const result: SaleHistoryListItem[] = [];
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload as string) as {
          createSaleDto?: { totalAmount?: string; clientId?: string; delivery?: unknown };
          metadata?: { localSaleId?: string; localNumber?: number; confirmedAt?: string; workstationId?: string };
        };
        const totalAmount = payload.createSaleDto?.totalAmount ?? '0';
        const confirmedAt = payload.metadata?.confirmedAt ?? row.sourceCreatedAt.toISOString();
        const localNumber = String(payload.metadata?.localNumber ?? row.clientSequence ?? '');
        const saleId = payload.metadata?.localSaleId ?? row.operationUuid;

        // Apply filters
        if (filters.since && new Date(confirmedAt) < filters.since) continue;
        if (filters.until && new Date(confirmedAt) > filters.until) continue;
        if (filters.clientId && payload.createSaleDto?.clientId !== filters.clientId) continue;
        if (filters.query) {
          const q = filters.query.toLowerCase();
          const hay = `${localNumber} ${saleId} ${totalAmount}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }

        // Try to resolve client name for display
        let clientName = 'CONSUMIDOR FINAL';
        let clientIdentificationNumber: string | null = null;
        const clientId = payload.createSaleDto?.clientId;
        if (clientId) {
          try {
            const client = await this.prisma.client.findUnique({
              where: { id: clientId },
              select: { fullName: true, identificationNumber: true },
            });
            if (client?.fullName) clientName = client.fullName;
            if (client?.identificationNumber) clientIdentificationNumber = client.identificationNumber;
          } catch {}
        }

        const delivery = payload.createSaleDto?.delivery as { feeCents?: number; address?: string } | null | undefined;

        result.push({
          saleId,
          localNumber,
          confirmedAt,
          totalAmount: String(totalAmount),
          clientName,
          clientIdentificationNumber,
          invoiceId: null,
          invoiceNumber: null,
          invoiceStatus: null,
          invoiceType: null,
          hasAdjustments: false,
          deliveryFeeCents: typeof delivery?.feeCents === 'number' ? delivery.feeCents : 0,
          deliveryAddress: typeof delivery?.address === 'string' ? delivery.address : null,
        });
      } catch {}
    }
    return result;
  }

  async getSaleHistoryDetail(saleId: string): Promise<SaleHistoryDetail | null> {
    // Try to serve a pending LAN sale directly from SyncQueue when no Sale row exists yet
    const pendingOp = await this.prisma.syncQueue.findFirst({
      where: { operationUuid: saleId },
    });
    // Also try by metadata.localSaleId for LAN-synthesized ids
    let pendingPayload: {
      createSaleDto?: {
        items?: Array<{ productId: string; quantity: number; unitPrice: string; discount?: string; discountReason?: string | null }>;
        clientId?: string;
        subtotal?: string;
        totalDiscount?: string;
        totalTax?: string;
        totalAmount?: string;
        delivery?: unknown;
      };
      confirmSaleDto?: { payments?: Array<{ paymentMethodId: string; amount: number }> };
      metadata?: { confirmedAt?: string; workstationId?: string; localNumber?: number };
    } | null = null;
    if (!pendingOp) {
      const byLocal = await this.prisma.syncQueue.findMany({
        where: { operationType: 'SALE_CONFIRMATION' },
        take: 100,
      });
      for (const r of byLocal) {
        try {
          const p = JSON.parse(r.payload as string);
          if (p.metadata?.localSaleId === saleId) {
            pendingPayload = p;
            break;
          }
        } catch {}
      }
    } else {
      try {
        pendingPayload = JSON.parse(pendingOp.payload as string);
      } catch {
        pendingPayload = null;
      }
    }

    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        items: true,
        payments: {
          include: { paymentMethod: { select: { name: true, category: true } } },
        },
      },
    });

    if (!sale && pendingPayload) {
      // Synthesize detail from SyncQueue payload for immediate LAN visibility
      const createDto = pendingPayload.createSaleDto;
      const confirmDto = pendingPayload.confirmSaleDto;
      const meta = pendingPayload.metadata;
      // Resolve client snapshot best-effort
      let clientName: string | null = null;
      let clientId: string | null = createDto?.clientId ?? null;
      let clientIdType: string | null = null;
      let clientIdNumber: string | null = null;
      if (clientId) {
        try {
          const c = await this.prisma.client.findUnique({
            where: { id: clientId },
            select: { fullName: true, identificationType: true, identificationNumber: true },
          });
          clientName = c?.fullName ?? null;
          clientIdType = (c?.identificationType as string) ?? null;
          clientIdNumber = c?.identificationNumber ?? null;
        } catch {}
      }
      // Map items with best-effort product snapshots
      const items: SaleHistoryItem[] = [];
      for (const it of createDto?.items ?? []) {
        let snap: { internalCode?: string; commercialName?: string; concentration?: string | null } = {};
        try {
          const prod = await this.prisma.product.findUnique({
            where: { id: it.productId },
            select: { internalCode: true, commercialName: true, concentration: true },
          });
          if (prod) snap = prod;
        } catch {}
        const unitPrice = it.unitPrice ?? '0';
        const discount = it.discount ?? '0';
        const subtotalNum = Number(unitPrice) * it.quantity;
        items.push({
          id: `pending-${saleId}-${it.productId}`,
          productId: it.productId,
          internalCode: snap.internalCode ?? it.productId.slice(0, 8),
          commercialName: snap.commercialName ?? it.productId,
          genericName: null,
          concentration: snap.concentration ?? null,
          quantity: it.quantity,
          unitPrice: String(unitPrice),
          discountPercentage: String(discount),
          discountAmount: '0',
          discountReason: it.discountReason ?? null,
          taxRate: '0',
          taxAmount: '0',
          subtotal: String(subtotalNum),
          total: String(subtotalNum),
        });
      }
      const payments: SaleHistoryPayment[] = [];
      for (const p of confirmDto?.payments ?? []) {
        let name = 'Unknown';
        try {
          const pm = await this.prisma.paymentMethod.findUnique({ where: { id: p.paymentMethodId }, select: { name: true } });
          if (pm?.name) name = pm.name;
        } catch {}
        payments.push({
          id: `pending-pay-${p.paymentMethodId}`,
          paymentMethodId: p.paymentMethodId,
          paymentMethodName: name,
          amount: String(p.amount),
          transactionReference: (p as { transactionReference?: string }).transactionReference ?? null,
          authorizationCode: null,
          cardBrand: null,
          cardLastFour: null,
        });
      }
      return {
        sale: {
          id: saleId,
          localNumber: String(meta?.localNumber ?? ''),
          confirmedAt: meta?.confirmedAt ?? new Date().toISOString(),
          subtotal: createDto?.subtotal ?? '0',
          totalDiscount: createDto?.totalDiscount ?? '0',
          totalTax: createDto?.totalTax ?? '0',
          totalAmount: createDto?.totalAmount ?? '0',
          changeAmount: '0',
          clientId,
          clientNameSnapshot: clientName,
          clientIdentificationTypeSnapshot: clientIdType,
          clientIdentificationNumberSnapshot: clientIdNumber,
          cashShiftId: '',
          workstationId: meta?.workstationId ?? '',
          userId: '',
          delivery: (createDto?.delivery as SaleDeliveryInfo | null) ?? null,
          items,
          payments,
        },
        invoices: [],
        mainInvoiceOperationalView: null,
        adjustmentHistory: [],
      };
    }

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
