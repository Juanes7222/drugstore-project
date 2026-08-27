import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { Prisma, PurchaseOrderState } from '@pharmacy/database';
import { paginateWithCursor } from '@/common/utils/cursor-pagination';
import * as crypto from 'crypto';
import {
  CreatePurchaseOrderDto,
  CreatePurchaseOrderItemDto,
} from '../dto/create-purchase-order.dto';
import { QueryPurchaseOrderDto } from '../dto/query-purchase-order.dto';
import { PurchaseOrderNotDraftException } from '../exceptions/purchase-order-not-draft.exception';
import { PurchaseOrderNotFoundException } from '../exceptions/purchase-order-not-found.exception';
import { ProductNotFoundException } from '@/modules/catalog/exceptions/product-not-found.exception';
import { SupplierNotFoundException } from '../exceptions/supplier-not-found.exception';
import { SuppliersService } from './suppliers.service';
import type { PurchaseOrderConfirmationPayload } from '@/modules/sync/dto/purchase-sync-payloads';
import { acquireAdvisoryLock } from '@/common/utils/advisory-lock';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private suppliersService: SuppliersService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private async ensureTenant(tx: Prisma.TransactionClient): Promise<void> {
    try {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${this.tenantContext.getSubscriptionId()}, true)`;
    } catch {}
  }

  async findAll(query: QueryPurchaseOrderDto): Promise<any> {
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.state) where.state = query.state as PurchaseOrderState;
    if (query.createdAtFrom || query.createdAtTo) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (query.createdAtFrom) dateFilter.gte = new Date(query.createdAtFrom);
      if (query.createdAtTo) dateFilter.lte = new Date(query.createdAtTo);
      where.createdAt = dateFilter;
    }

    const listInclude = {
      supplier: true,
      items: true,
    } satisfies Prisma.PurchaseOrderInclude;

    if (query.cursor) {
      const page = await paginateWithCursor<
        unknown,
        Prisma.PurchaseOrderWhereInput,
        Prisma.PurchaseOrderOrderByWithRelationInput,
        Prisma.PurchaseOrderInclude
      >({
        model: this.prisma.purchaseOrder,
        baseWhere: where,
        limit: query.pageSize,
        cursor: query.cursor,
        timeField: 'createdAt',
        direction: 'desc',
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: listInclude,
      });
      return {
        data: page.items,
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
        pageSize: query.pageSize,
      };
    }

    const [purchaseOrders, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: listInclude,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return {
      data: purchaseOrders,
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * Sync-pull purchase orders with cursor-based pagination for POS hydration.
   *
   * Walks (createdAt asc, id asc) — PurchaseOrder has no updatedAt, so
   * incremental pulls filter on createdAt >= updatedSince. Includes items
   * so the POS can upsert locally without a second fetch. Tenant-scoped
   * via subscriptionId; shape { data, nextCursor, hasMore }.
   */
  async findSync(input: {
    updatedSince?: string;
    cursor?: string | null;
    limit?: number;
  }): Promise<{
    data: unknown[];
    nextCursor: string | null;
    hasMore: boolean;
  }> {
    const baseWhere: Prisma.PurchaseOrderWhereInput = {
      subscriptionId: this.tenantContext.getSubscriptionId(),
    };
    if (input.updatedSince) {
      baseWhere.createdAt = { gte: new Date(input.updatedSince) };
    }

    const page = await paginateWithCursor<
      unknown,
      Prisma.PurchaseOrderWhereInput,
      Prisma.PurchaseOrderOrderByWithRelationInput,
      Prisma.PurchaseOrderInclude
    >({
      model: this.prisma.purchaseOrder,
      baseWhere,
      limit: input.limit ?? 200,
      cursor: input.cursor ?? null,
      timeField: 'createdAt',
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { supplier: true, items: true },
    });

    return {
      data: page.items,
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
    };
  }

  async findById(id: string): Promise<any> {
    const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { supplier: true, items: true },
    });
    // PurchaseOrderItem has productId as a scalar with no Prisma-level relation declared.
    // Fetch product details separately if needed.
    if (purchaseOrder && purchaseOrder.items.length > 0) {
      const productIds = [
        ...new Set(purchaseOrder.items.map((i: any) => i.productId)),
      ];
      const products = await this.prisma.product.findMany({
        where: { id: { in: productIds } },
      });
      const productMap = new Map(products.map((p) => [p.id, p]));
      purchaseOrder.items = purchaseOrder.items.map((item: any) => ({
        ...item,
        product: productMap.get(item.productId) ?? null,
      }));
    }
    if (!purchaseOrder) {
      throw new PurchaseOrderNotFoundException(id);
    }
    return purchaseOrder;
  }

  async create(
    createDto: CreatePurchaseOrderDto,
    userId: string,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureTenant(tx);
      const supplier = await tx.supplier.findUnique({
        where: { id: createDto.supplierId },
      });
      if (!supplier) {
        throw new SupplierNotFoundException(createDto.supplierId);
      }

      // Sequential — adapter-pg: single connection per interactive tx.
      const itemsData: Array<{
        id: string;
        subscriptionId: string;
        productId: string;
        requestedQuantity: number;
        receivedQuantity: number;
        pendingQuantity: number;
        expectedUnitCost: Prisma.Decimal;
      }> = [];
      for (const itemDto of createDto.items) {
        const product = await tx.product.findUnique({
          where: { id: itemDto.productId },
        });
        if (!product) {
          throw new ProductNotFoundException(itemDto.productId);
        }
        itemsData.push({
          id: crypto.randomUUID(),
          subscriptionId: this.tenantContext.getSubscriptionId(),
          productId: itemDto.productId,
          requestedQuantity: itemDto.requestedQuantity,
          receivedQuantity: 0,
          pendingQuantity: itemDto.requestedQuantity,
          expectedUnitCost: new Prisma.Decimal(itemDto.expectedUnitCost),
        });
      }

      const subtotal = itemsData.reduce(
        (sum, item) =>
          sum.plus(
            new Prisma.Decimal(item.requestedQuantity).times(
              item.expectedUnitCost,
            ),
          ),
        new Prisma.Decimal(0),
      );
      // For now, totalTax and totalAmount are same as subtotal, as tax calculation is not in scope for PO
      const totalTax = new Prisma.Decimal(0);
      const totalAmount = subtotal;

      // Serialize sequential-number allocation per tenant so two concurrent
      // cashier creations cannot read the same MAX and produce duplicates.
      await acquireAdvisoryLock(
        tx,
        `${this.tenantContext.getSubscriptionId()}:purchase-order:seq`,
      );

      const sequentialNumber = await this.getNextSequentialNumber(tx);

      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          id: crypto.randomUUID(),
          subscriptionId: this.tenantContext.getSubscriptionId(),
          sequentialNumber,
          state: PurchaseOrderState.DRAFT,
          supplierId: createDto.supplierId,
          expectedDeliveryDate: createDto.expectedDeliveryDate
            ? new Date(createDto.expectedDeliveryDate)
            : null,
          notes: createDto.notes,
          subtotal,
          totalTax,
          totalAmount,
          createdById: userId,
          items: { create: itemsData },
        },
      });
      return purchaseOrder;
    });
  }

  async confirm(id: string, userId: string): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureTenant(tx);
      const purchaseOrder = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });

      if (!purchaseOrder) {
        throw new PurchaseOrderNotFoundException(id);
      }
      if (purchaseOrder.state !== PurchaseOrderState.DRAFT) {
        throw new PurchaseOrderNotDraftException(id);
      }
      if (purchaseOrder.items.length === 0) {
        throw new Error(
          'Purchase order must have at least one item to be confirmed.',
        ); // Should be caught by DTO validation
      }

      const updatedPurchaseOrder = await tx.purchaseOrder.update({
        where: { id },
        data: {
          state: PurchaseOrderState.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: userId,
        },
      });
      return updatedPurchaseOrder;
    });
  }

  /**
   * Creates or confirms a purchase order from a sync payload.
   *
   * Idempotent: if a purchase order with the same sequentialNumber +
   * supplierId already exists, the operation is skipped (ALREADY_ACCEPTED).
   * Resolves the supplier (creating inline if needed and data is provided)
   * and validates all products exist before creating.
   */
  async confirmOrderFromSync(
    payload: PurchaseOrderConfirmationPayload,
    userId: string,
  ): Promise<any> {
    return this.prisma.$transaction(async (tx) => {
      await this.ensureTenant(tx);
      // Serialize concurrent access to this order ID via PostgreSQL advisory
      // lock. BullMQ may deliver the same job to two workers concurrently; the
      // lock ensures only one worker reaches the idempotency check + create
      // section at a time, preventing a P2002 race.
      await acquireAdvisoryLock(
        tx,
        `${this.tenantContext.getSubscriptionId()}:purchase-order:${payload.orderId}`,
      );

      // Idempotency: check by POS-originated id first. If the same PO was
      // already created from an earlier sync attempt, return it. The
      // (sequentialNumber, supplierId) check is a fallback for POs that
      // pre-date the POS-originated id convention.
      const existingById = await tx.purchaseOrder.findUnique({
        where: { id: payload.orderId },
        select: { id: true, state: true },
      });
      if (existingById) {
        return existingById;
      }

      const existing = await tx.purchaseOrder.findFirst({
        where: {
          sequentialNumber: payload.sequentialNumber,
          supplierId: payload.supplierId,
        },
        select: { id: true, state: true },
      });
      if (existing) {
        return existing;
      }

      // Resolve supplier — create inline if missing and payload carries data
      await this.suppliersService.resolveSupplierForSync(
        tx,
        payload.supplierId,
        payload.supplier,
        userId,
      );

      // Build items data if present; legacy payloads may omit `items`.
      // When missing, the PO header is created without items so the
      // sync operation can complete and subsequent receptions can
      // reference this PO. A note is appended to signal the gap.
      let itemsData: Array<{
        id: string;
        subscriptionId: string;
        productId: string;
        requestedQuantity: number;
        receivedQuantity: number;
        pendingQuantity: number;
        expectedUnitCost: Prisma.Decimal;
      }> = [];
      let subtotal = new Prisma.Decimal(0);

      if (payload.items && payload.items.length > 0) {
        itemsData = [];
        for (const item of payload.items) {
          const product = await tx.product.findUnique({
            where: { id: item.productId },
          });
          if (!product) {
            throw new ProductNotFoundException(item.productId);
          }
          itemsData.push({
            id: crypto.randomUUID(),
            subscriptionId: this.tenantContext.getSubscriptionId(),
            productId: item.productId,
            requestedQuantity: item.requestedQuantity,
            receivedQuantity: 0,
            pendingQuantity: item.requestedQuantity,
            expectedUnitCost: new Prisma.Decimal(item.expectedUnitCost),
          });
        }

        subtotal = itemsData.reduce(
          (sum, item) =>
            sum.plus(
              new Prisma.Decimal(item.requestedQuantity).times(
                item.expectedUnitCost,
              ),
            ),
          new Prisma.Decimal(0),
        );
      }

      // Compute notes — append a marker when items were missing from payload
      let notes = payload.notes ?? null;
      if (!payload.items || payload.items.length === 0) {
        const legacyMarker = '[Legacy sync: items metadata unavailable]';
        notes = notes ? `${notes} ${legacyMarker}` : legacyMarker;
      }

      // Server sequentialNumber is global per subscription (@@unique [subscriptionId, sequentialNumber]),
      // but POS local sequentialNumbers are per-workstation and can collide with
      // existing server numbers (e.g. payload 1 vs server po_disfarma 1). Don't use
      // payload's number directly; allocate the next global number instead.
      // Advisory lock at the top of this transaction already serializes allocation.
      const sequentialNumber = await this.getNextSequentialNumber(tx);
      // Use the POS-originated order ID so downstream sync operations
      // (receptions, returns) can reference this PO by the same ID.
      const purchaseOrder = await tx.purchaseOrder.create({
        data: {
          id: payload.orderId,
          subscriptionId: this.tenantContext.getSubscriptionId(),
          sequentialNumber,
          state: PurchaseOrderState.CONFIRMED,
          supplierId: payload.supplierId,
          notes,
          subtotal,
          totalTax: new Prisma.Decimal(0),
          totalAmount: subtotal,
          createdById: userId,
          confirmedById: userId,
          confirmedAt: new Date(payload.confirmedAt),
          items: itemsData.length > 0 ? { create: itemsData } : undefined,
        },
      });

      return purchaseOrder;
    });
  }

  async annul(id: string): Promise<any> {
    // Annulment logic is deferred
    throw new Error('Annulment not implemented for this phase.');
  }

  private async getNextSequentialNumber(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const latestOrder = await tx.purchaseOrder.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latestOrder?.sequentialNumber || 0) + 1;
  }
}
