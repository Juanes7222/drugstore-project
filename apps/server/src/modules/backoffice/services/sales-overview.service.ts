/**
 * Backoffice sales overview — paginated sale listing with totals summary,
 * single-sale detail, and CSV export for the caller's tenant. Read-only;
 * mutations stay in sales-pos. User/workstation display data is joined in
 * memory via BackofficeActorLookupService because Sale declares no
 * relation fields to those models.
 */

import { Injectable } from '@nestjs/common';
import { Prisma } from '@pharmacy/database';
import { User } from '@pharmacy/shared-types';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BackofficeScopeService } from './backoffice-scope.service';
import {
  ActorSummary,
  BackofficeActorLookupService,
  WorkstationSummary,
} from './backoffice-actor-lookup.service';
import { CsvBuilderService } from './csv-builder.service';
import { SaleNotFoundException } from '../exceptions/sale-not-found.exception';

export interface SalesFilterQuery {
  from?: string;
  to?: string;
  state?: string;
  userId?: string;
  workstationId?: string;
}

export interface SalesOverviewQuery extends SalesFilterQuery {
  page?: number;
  pageSize?: number;
}

export interface SalesOverviewResult {
  data: unknown[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: {
    count: number;
    totalAmount: string;
    totalTax: string;
    totalDiscount: string;
  };
}

export interface SaleDetailItem {
  id: string;
  productName: string;
  quantity: number;
  unitPrice: string;
  lineDiscount: string;
  lineTax: string;
  lineTotal: string;
}

export interface SaleDetailResult {
  id: string;
  localNumber: number;
  internalNumber: string | null;
  operationalState: string;
  confirmedAt: string | null;
  annulledAt: string | null;
  annulmentReason: string | null;
  clientNameSnapshot: string | null;
  subtotal: string;
  totalDiscount: string;
  totalTax: string;
  totalAmount: string;
  user: ActorSummary;
  workstation: WorkstationSummary;
  items: SaleDetailItem[];
}

const SALE_LIST_SELECT = {
  id: true,
  localNumber: true,
  internalNumber: true,
  operationalState: true,
  confirmedAt: true,
  annulledAt: true,
  subtotal: true,
  totalDiscount: true,
  totalTax: true,
  totalAmount: true,
  annulmentReason: true,
  clientNameSnapshot: true,
  userId: true,
  workstationId: true,
} satisfies Prisma.SaleSelect;

type SaleListPayload = Prisma.SaleGetPayload<{
  select: typeof SALE_LIST_SELECT;
}>;

const SALE_DETAIL_ITEMS_ARGS = {
  // Stable line order across calls; SaleItem carries no sequence column.
  orderBy: { id: 'asc' },
  select: {
    id: true,
    productCommercialNameSnapshot: true,
    quantity: true,
    unitPrice: true,
    discountAmount: true,
    taxAmount: true,
    total: true,
  },
} satisfies Prisma.Sale$itemsArgs;

type SaleDetailItemsPayload = Prisma.SaleItemGetPayload<{
  select: (typeof SALE_DETAIL_ITEMS_ARGS)['select'];
}>;

const SALE_DETAIL_SELECT = {
  id: true,
  localNumber: true,
  internalNumber: true,
  operationalState: true,
  confirmedAt: true,
  annulledAt: true,
  annulmentReason: true,
  clientNameSnapshot: true,
  subtotal: true,
  totalDiscount: true,
  totalTax: true,
  totalAmount: true,
  userId: true,
  workstationId: true,
  items: SALE_DETAIL_ITEMS_ARGS,
} satisfies Prisma.SaleSelect;

const SALES_CSV_SELECT = {
  internalNumber: true,
  localNumber: true,
  operationalState: true,
  confirmedAt: true,
  annulledAt: true,
  annulmentReason: true,
  clientNameSnapshot: true,
  subtotal: true,
  totalDiscount: true,
  totalTax: true,
  totalAmount: true,
  userId: true,
  workstationId: true,
} satisfies Prisma.SaleSelect;

type SalesCsvPayload = Prisma.SaleGetPayload<{
  select: typeof SALES_CSV_SELECT;
}>;

// Spanish headers are product content for the exported file, matching the
// backoffice UI vocabulary — not user-facing error text.
const SALES_CSV_HEADERS = [
  'Número interno',
  'Número de local',
  'Estado',
  'Confirmada',
  'Anulada',
  'Motivo de anulación',
  'Cliente',
  'Cajero',
  'Terminal',
  'Subtotal',
  'Descuento',
  'IVA',
  'Total',
] as const;

@Injectable()
export class SalesOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly scope: BackofficeScopeService,
    private readonly actorLookup: BackofficeActorLookupService,
    private readonly csvBuilder: CsvBuilderService,
  ) {}

  async getSales(
    user: User,
    query: SalesOverviewQuery,
  ): Promise<SalesOverviewResult> {
    const where: Record<string, unknown> = {
      ...this.scope.saleTenantWhere(user),
      ...this.buildSaleFilters(query),
    };

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.max(1, Math.min(100, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const [sales, total, summary] = await Promise.all([
      this.prisma.sale.findMany({
        where,
        orderBy: { confirmedAt: { sort: 'desc', nulls: 'last' } },
        skip,
        take: pageSize,
        select: SALE_LIST_SELECT,
      }),
      this.prisma.sale.count({ where }),
      this.prisma.sale.aggregate({
        where: { ...where, confirmedAt: { not: null } },
        _count: { id: true },
        _sum: { totalAmount: true, totalTax: true, totalDiscount: true },
      }),
    ]);

    const [usersById, workstationsById] = await Promise.all([
      this.actorLookup.loadUsersById(sales.map((sale) => sale.userId)),
      this.actorLookup.loadWorkstationsById(
        sales.map((sale) => sale.workstationId),
      ),
    ]);

    return {
      data: sales.map((sale) =>
        this.withActorData(
          sale,
          usersById.get(sale.userId),
          workstationsById.get(sale.workstationId),
        ),
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
      summary: {
        count: summary._count.id,
        totalAmount: summary._sum.totalAmount?.toString() ?? '0',
        totalTax: summary._sum.totalTax?.toString() ?? '0',
        totalDiscount: summary._sum.totalDiscount?.toString() ?? '0',
      },
    };
  }

  /**
   * Single-sale detail including line items. A sale outside the caller's
   * tenant scope is indistinguishable from a missing one (404 either way).
   */
  async getSaleDetail(user: User, saleId: string): Promise<SaleDetailResult> {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, ...this.scope.saleTenantWhere(user) },
      select: SALE_DETAIL_SELECT,
    });
    if (!sale) {
      throw new SaleNotFoundException(saleId);
    }

    const [usersById, workstationsById] = await Promise.all([
      this.actorLookup.loadUsersById([sale.userId]),
      this.actorLookup.loadWorkstationsById([sale.workstationId]),
    ]);
    const actor = usersById.get(sale.userId);
    const workstation = workstationsById.get(sale.workstationId);
    if (!actor || !workstation) {
      throw new SaleNotFoundException(saleId);
    }

    return {
      id: sale.id,
      localNumber: Number(sale.localNumber),
      internalNumber:
        sale.internalNumber === null ? null : String(sale.internalNumber),
      operationalState: sale.operationalState,
      confirmedAt: sale.confirmedAt?.toISOString() ?? null,
      annulledAt: sale.annulledAt?.toISOString() ?? null,
      annulmentReason: sale.annulmentReason,
      clientNameSnapshot: sale.clientNameSnapshot,
      subtotal: sale.subtotal.toString(),
      totalDiscount: sale.totalDiscount.toString(),
      totalTax: sale.totalTax.toString(),
      totalAmount: sale.totalAmount.toString(),
      user: actor,
      workstation,
      items: sale.items.map((item) => this.toSaleDetailItem(item)),
    };
  }

  /**
   * CSV export of every sale matching the list filters, without pagination.
   * Returns the full payload (BOM included); the controller sets headers.
   */
  async getSalesCsv(user: User, query: SalesFilterQuery): Promise<string> {
    const sales = await this.prisma.sale.findMany({
      where: {
        ...this.scope.saleTenantWhere(user),
        ...this.buildSaleFilters(query),
      },
      orderBy: { confirmedAt: { sort: 'desc', nulls: 'last' } },
      select: SALES_CSV_SELECT,
    });

    const [usersById, workstationsById] = await Promise.all([
      this.actorLookup.loadUsersById(sales.map((sale) => sale.userId)),
      this.actorLookup.loadWorkstationsById(
        sales.map((sale) => sale.workstationId),
      ),
    ]);

    return this.csvBuilder.buildCsv(
      SALES_CSV_HEADERS,
      sales.map((sale) =>
        this.toSalesCsvRow(
          sale,
          usersById.get(sale.userId),
          workstationsById.get(sale.workstationId),
        ),
      ),
    );
  }

  private buildSaleFilters(query: SalesFilterQuery): Record<string, unknown> {
    const filters: Record<string, unknown> = {};
    if (query.from || query.to) {
      filters.confirmedAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }
    if (query.state) {
      filters.operationalState = query.state;
    }
    if (query.userId) {
      filters.userId = query.userId;
    }
    if (query.workstationId) {
      filters.workstationId = query.workstationId;
    }
    return filters;
  }

  /**
   * Attach the user/workstation display objects the list API has always
   * returned, keeping the response shape stable across the lookup change.
   * A deleted referenced row falls back to empty strings rather than
   * dropping the sale from the listing.
   */
  private withActorData(
    sale: SaleListPayload,
    actor: ActorSummary | undefined,
    workstation: WorkstationSummary | undefined,
  ) {
    return {
      ...sale,
      user: {
        displayName: actor?.displayName ?? null,
        fullName: actor?.fullName ?? '',
      },
      workstation: {
        name: workstation?.name ?? '',
        code: workstation?.code ?? '',
      },
    };
  }

  private toSaleDetailItem(item: SaleDetailItemsPayload): SaleDetailItem {
    return {
      id: item.id,
      productName: item.productCommercialNameSnapshot,
      quantity: item.quantity,
      unitPrice: item.unitPrice.toString(),
      lineDiscount: item.discountAmount.toString(),
      lineTax: item.taxAmount.toString(),
      lineTotal: item.total.toString(),
    };
  }

  private toSalesCsvRow(
    sale: SalesCsvPayload,
    actor: ActorSummary | undefined,
    workstation: WorkstationSummary | undefined,
  ): string[] {
    return [
      sale.internalNumber === null ? '' : String(sale.internalNumber),
      sale.localNumber.toString(),
      sale.operationalState,
      this.csvBuilder.formatDateTime(sale.confirmedAt),
      this.csvBuilder.formatDateTime(sale.annulledAt),
      sale.annulmentReason ?? '',
      sale.clientNameSnapshot ?? '',
      actor ? (actor.displayName ?? actor.fullName) : '',
      workstation?.name ?? '',
      sale.subtotal.toString(),
      sale.totalDiscount.toString(),
      sale.totalTax.toString(),
      sale.totalAmount.toString(),
    ];
  }
}
