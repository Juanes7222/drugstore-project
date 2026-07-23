/**
 * Local purchase-orders service for the offline-first POS.
 *
 * Purchase orders track planned inventory receipts. They start in DRAFT,
 * transition to CONFIRMED (triggering sync), and may be updated to
 * PARTIALLY_RECEIVED / FULLY_RECEIVED by purchase receptions or ANNULLED.
 *
 * The POS is a single-writer authority for its own local database — these
 * operations are atomic within Prisma transactions.
 */
import {
  PrismaClient,
  Prisma,
  PurchaseOrderState,
  SyncOperationType,
} from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';
import {
  SupplierNotFoundException,
  PurchaseOrderNotFoundException,
  PurchaseOrderNotDraftException,
  PurchaseOrderNotConfirmableException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreatePurchaseOrderItemInput {
  productId: string;
  requestedQuantity: number;
  expectedUnitCost: number;
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  expectedDeliveryDate?: string;
  notes?: string;
  items: CreatePurchaseOrderItemInput[];
}

export interface PurchaseOrderItemResult {
  id: string;
  productId: string;
  requestedQuantity: number;
  receivedQuantity: number;
  pendingQuantity: number;
  expectedUnitCost: number;
}

export interface PurchaseOrderResult {
  id: string;
  sequentialNumber: number;
  state: string;
  supplierId: string;
  supplier: { id: string; businessName: string };
  expectedDeliveryDate: string | null;
  notes: string | null;
  subtotal: number;
  totalTax: number;
  totalAmount: number;
  createdAt: string;
  createdById: string;
  confirmedAt: string | null;
  confirmedById: string | null;
  annulledAt: string | null;
  items: PurchaseOrderItemResult[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createPurchaseOrdersService = (
  prisma: PrismaClient,
  auth: AuthService,
): PurchaseOrdersService => {
  return new PurchaseOrdersService(prisma, auth);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  /**
   * List purchase orders with optional filters.
   */
  async listOrders(params?: {
    supplierId?: string;
    state?: PurchaseOrderState;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: PurchaseOrderResult[]; total: number }> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;

    const where: Prisma.PurchaseOrderWhereInput = {};
    if (params?.supplierId) where.supplierId = params.supplierId;
    if (params?.state) where.state = params.state;

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, businessName: true } },
          items: true,
        },
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return {
      data: orders.map((o) => this.mapOrder(o, o.items)),
      total,
    };
  }

  /**
   * Get a single purchase order by ID with items.
   * @throws PurchaseOrderNotFoundException
   */
  async getOrder(id: string): Promise<PurchaseOrderResult> {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, businessName: true } },
        items: true,
      },
    });
    if (!order) throw new PurchaseOrderNotFoundException(id);
    return this.mapOrder(order, order.items);
  }

  /**
   * Create a purchase order in DRAFT state.
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   */
  async createOrder(input: CreatePurchaseOrderInput): Promise<PurchaseOrderResult> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    return this.prisma.$transaction(async (tx) => {
      // Validate supplier exists
      const supplier = await tx.supplier.findUnique({
        where: { id: input.supplierId },
        select: { id: true, businessName: true },
      });
      if (!supplier) throw new SupplierNotFoundException(input.supplierId);

      // Build items
      const itemsData = input.items.map((item) => ({
        id: globalThis.crypto.randomUUID(),
        productId: item.productId,
        requestedQuantity: item.requestedQuantity,
        receivedQuantity: 0,
        pendingQuantity: item.requestedQuantity,
        expectedUnitCost: new Prisma.Decimal(item.expectedUnitCost),
      }));

      // Calculate totals
      const subtotal = itemsData.reduce(
        (sum, item) => sum.plus(new Prisma.Decimal(item.requestedQuantity).times(item.expectedUnitCost)),
        new Prisma.Decimal(0),
      );

      // Get next sequential number
      const sequentialNumber = await this.getNextSequentialNumber(tx);

      const order = await tx.purchaseOrder.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          sequentialNumber,
          state: PurchaseOrderState.DRAFT,
          supplierId: input.supplierId,
          expectedDeliveryDate: input.expectedDeliveryDate
            ? new Date(input.expectedDeliveryDate)
            : null,
          notes: input.notes ?? null,
          subtotal,
          totalTax: new Prisma.Decimal(0),
          totalAmount: subtotal,
          createdById: session.userId,
          items: { create: itemsData },
        },
        include: {
          supplier: { select: { id: true, businessName: true } },
          items: true,
        },
      });

      return this.mapOrder(order, order.items);
    });
  }

  /**
   * Confirm a DRAFT purchase order — transitions to CONFIRMED.
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * A confirmed PO cannot be edited. It may later be updated by purchase
   * receptions (PARTIALLY_RECEIVED / FULLY_RECEIVED) or annulled.
   *
   * @throws PurchaseOrderNotFoundException
   * @throws PurchaseOrderNotDraftException
   * @throws PurchaseOrderNotConfirmableException if the PO has no items
   */
  async confirmOrder(id: string): Promise<PurchaseOrderResult> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!order) throw new PurchaseOrderNotFoundException(id);
      if (order.state !== PurchaseOrderState.DRAFT) {
        throw new PurchaseOrderNotDraftException(id, order.state);
      }
      if (order.items.length === 0) {
        throw new PurchaseOrderNotConfirmableException(id, 'Purchase order has no items.');
      }

      const confirmedAt = new Date();
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          state: PurchaseOrderState.CONFIRMED,
          confirmedAt,
          confirmedById: session.userId,
        },
        include: {
          supplier: { select: { id: true, businessName: true } },
          items: true,
        },
      });

      // Create SyncQueue entry
      await this.createSyncQueueEntry(tx, order, session, confirmedAt);

      return this.mapOrder(updated, updated.items);
    });
  }

  /**
   * Annul a purchase order (only if in DRAFT state).
   * Requires ADMIN role.
   */
  async annulOrder(
    id: string,
    reason?: string,
  ): Promise<PurchaseOrderResult> {
    const session = this.auth.requireRole(RoleType.ADMIN);

    return this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!order) throw new PurchaseOrderNotFoundException(id);
      if (order.state !== PurchaseOrderState.DRAFT) {
        throw new PurchaseOrderNotDraftException(id, order.state);
      }

      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: {
          state: PurchaseOrderState.ANNULLED,
          annulledAt: new Date(),
          annulledById: session.userId,
          annulmentReason: reason ?? null,
        },
        include: {
          supplier: { select: { id: true, businessName: true } },
          items: true,
        },
      });

      return this.mapOrder(updated, updated.items);
    });
  }

  // ---------------------------------------------------------------------------
  // Private — sync
  // ---------------------------------------------------------------------------

  private async createSyncQueueEntry(
    tx: Prisma.TransactionClient,
    order: { id: string; sequentialNumber: number; supplierId: string; notes: string | null; createdById: string },
    session: { userId: string; workstationId: string },
    confirmedAt: Date,
  ): Promise<void> {
    const payload = JSON.stringify({
      operationType: 'PURCHASE_ORDER_CONFIRMATION',
      orderId: order.id,
      sequentialNumber: order.sequentialNumber,
      supplierId: order.supplierId,
      notes: order.notes,
      createdById: order.createdById,
      confirmedByUserId: session.userId,
      workstationId: session.workstationId,
      confirmedAt: confirmedAt.toISOString(),
    });

    const payloadBytes = new TextEncoder().encode(payload);
    const latestSeq = await tx.syncQueue.findFirst({
      where: { sourceWorkstationId: session.workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

    await tx.syncQueue.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        operationUuid: globalThis.crypto.randomUUID(),
        operationType: SyncOperationType.PURCHASE_ORDER_CONFIRMATION,
        payload,
        payloadHash: await this.computeHash(payload),
        payloadSize: payloadBytes.length,
        versionSchema: 1,
        status: 'PENDING',
        retryCount: 0,
        sourceWorkstationId: session.workstationId,
        sourceCreatedAt: confirmedAt,
        clientSequence,
      },
    });
  }

  private async computeHash(payload: string): Promise<string> {
    const data = new TextEncoder().encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async getNextSequentialNumber(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const latest = await tx.purchaseOrder.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latest?.sequentialNumber ?? 0) + 1;
  }

  private mapOrder(
    order: {
      id: string;
      sequentialNumber: number;
      state: string;
      supplierId: string;
      supplier: { id: string; businessName: string };
      expectedDeliveryDate: Date | null;
      notes: string | null;
      subtotal: Prisma.Decimal;
      totalTax: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      createdAt: Date;
      createdById: string;
      confirmedAt: Date | null;
      confirmedById: string | null;
      annulledAt: Date | null;
    },
    items: Array<{
      id: string;
      productId: string;
      requestedQuantity: number;
      receivedQuantity: number;
      pendingQuantity: number;
      expectedUnitCost: Prisma.Decimal;
    }>,
  ): PurchaseOrderResult {
    return {
      id: order.id,
      sequentialNumber: order.sequentialNumber,
      state: order.state,
      supplierId: order.supplierId,
      supplier: order.supplier,
      expectedDeliveryDate: order.expectedDeliveryDate?.toISOString() ?? null,
      notes: order.notes,
      subtotal: Number(order.subtotal),
      totalTax: Number(order.totalTax),
      totalAmount: Number(order.totalAmount),
      createdAt: order.createdAt.toISOString(),
      createdById: order.createdById,
      confirmedAt: order.confirmedAt?.toISOString() ?? null,
      confirmedById: order.confirmedById,
      annulledAt: order.annulledAt?.toISOString() ?? null,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        requestedQuantity: item.requestedQuantity,
        receivedQuantity: item.receivedQuantity,
        pendingQuantity: item.pendingQuantity,
        expectedUnitCost: Number(item.expectedUnitCost),
      })),
    };
  }
}
