/**
 * Local purchase-receptions service for the offline-first POS.
 *
 * A purchase reception records the physical receipt of inventory from a
 * supplier.  On confirmation, stock is added to lots, inventory movements
 * are recorded, and a SyncQueue entry is created for server-side
 * reconciliation.
 *
 * ## Stock authority
 * The local POS is the single writer to its own PGlite database.  Lot
 * mutations use optimistic locking via the `version` column as a correctness
 * backstop against the unlikely case of concurrent local writes.
 */
import {
  PrismaClient,
  Prisma,
  PurchaseReceptionState,
  PurchaseOrderState,
  LotState,
  MovementType,
  SyncOperationType,
} from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';
import {
  SupplierNotFoundException,
  PurchaseReceptionNotFoundException,
  PurchaseReceptionNotDraftException,
  PurchaseReceptionNotConfirmedException,
  PurchaseOrderNotFoundException,
  PurchaseOrderItemNotFoundException,
  PurchaseOrderItemMismatchException,
  ConcurrentStockModificationException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreateReceptionItemInput {
  productId: string;
  /** Quantity actually received. */
  receivedQuantity: number;
  /** Optional purchase order item ID this reception item fulfills. */
  purchaseOrderItemId?: string;
  /** Batch/lot number printed on the received goods. */
  lotNumber?: string;
  /** Expiration date as ISO-8601 string (YYYY-MM-DD or full datetime). */
  expirationDate?: string;
  /** Real unit cost from the supplier invoice. */
  realUnitCost: number;
  /** Tax scheme UUID (e.g. IVA, INC). */
  taxSchemeId: string;
  /** Tax rate as a percentage (e.g. 19 for 19%). */
  taxRate: number;
  /** Discount amount applied to this item. */
  discountAmount?: number;
}

export interface CreateReceptionInput {
  supplierId: string;
  /** Optional purchase order this reception fulfills. */
  purchaseOrderId?: string;
  notes?: string;
  items: CreateReceptionItemInput[];
}

export interface ReceptionItemResult {
  id: string;
  productId: string;
  purchaseOrderItemId: string | null;
  lotId: string | null;
  receivedQuantity: number;
  lotNumber: string | null;
  expirationDate: string | null;
  realUnitCost: number;
  taxSchemeId: string;
  taxRate: number;
  discountAmount: number;
  subtotal: number;
  total: number;
}

export interface ReceptionResult {
  id: string;
  sequentialNumber: number;
  state: string;
  supplierId: string;
  supplier: { id: string; businessName: string };
  purchaseOrderId: string | null;
  purchaseOrder: { id: string; sequentialNumber: number; state: string } | null;
  notes: string | null;
  subtotal: number;
  totalTax: number;
  totalAmount: number;
  createdAt: string;
  createdById: string;
  receivedAt: string | null;
  items: ReceptionItemResult[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createPurchaseReceptionsService = (
  prisma: PrismaClient,
  auth: AuthService,
): PurchaseReceptionsService => {
  return new PurchaseReceptionsService(prisma, auth);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PurchaseReceptionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  /**
   * List purchase receptions with optional filters.
   */
  async listReceptions(params?: {
    supplierId?: string;
    purchaseOrderId?: string;
    state?: PurchaseReceptionState;
    page?: number;
    pageSize?: number;
  }): Promise<{ data: ReceptionResult[]; total: number }> {
    const page = params?.page ?? 1;
    const pageSize = params?.pageSize ?? 50;

    const where: Prisma.PurchaseReceptionWhereInput = {};
    if (params?.supplierId) where.supplierId = params.supplierId;
    if (params?.purchaseOrderId) where.purchaseOrderId = params.purchaseOrderId;
    if (params?.state) where.state = params.state;

    const [receptions, total] = await this.prisma.$transaction([
      this.prisma.purchaseReception.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          supplier: { select: { id: true, businessName: true } },
          purchaseOrder: { select: { id: true, sequentialNumber: true, state: true } },
          items: true,
        },
      }),
      this.prisma.purchaseReception.count({ where }),
    ]);

    return {
      data: receptions.map((r) => this.mapReception(r, r.items)),
      total,
    };
  }

  /**
   * Get a single purchase reception by ID.
   * @throws PurchaseReceptionNotFoundException
   */
  async getReception(id: string): Promise<ReceptionResult> {
    const reception = await this.prisma.purchaseReception.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, businessName: true } },
        purchaseOrder: { select: { id: true, sequentialNumber: true, state: true } },
        items: true,
      },
    });
    if (!reception) throw new PurchaseReceptionNotFoundException(id);
    return this.mapReception(reception, reception.items);
  }

  /**
   * Create a purchase reception in DRAFT state.
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * Stock is NOT modified at this stage — that happens on confirm().
   */
  async createReception(input: CreateReceptionInput): Promise<ReceptionResult> {
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

      // Validate purchase order if provided
      let purchaseOrder: { id: string; sequentialNumber: number; state: string } | null = null;
      if (input.purchaseOrderId) {
        purchaseOrder = await tx.purchaseOrder.findUnique({
          where: { id: input.purchaseOrderId },
          select: { id: true, sequentialNumber: true, state: true },
        });
        if (!purchaseOrder) throw new PurchaseOrderNotFoundException(input.purchaseOrderId);
      }

      // Build items data (pre-validate purchase order item links)
      const itemsData = await Promise.all(
        input.items.map(async (item) => {
          if (item.purchaseOrderItemId) {
            const poItem = await tx.purchaseOrderItem.findUnique({
              where: { id: item.purchaseOrderItemId },
            });
            if (!poItem) {
              throw new PurchaseOrderItemNotFoundException(item.purchaseOrderItemId);
            }
            if (poItem.purchaseOrderId !== input.purchaseOrderId) {
              throw new PurchaseOrderItemMismatchException(
                item.purchaseOrderItemId,
                'Does not belong to the specified purchase order.',
              );
            }
            if (poItem.productId !== item.productId) {
              throw new PurchaseOrderItemMismatchException(
                item.purchaseOrderItemId,
                'Product ID mismatch.',
              );
            }
          }

          const lineSubtotal = new Prisma.Decimal(item.receivedQuantity)
            .times(item.realUnitCost)
            .minus(item.discountAmount ?? 0);
          const taxAmount = lineSubtotal.times(item.taxRate).dividedBy(100);

          return {
            id: globalThis.crypto.randomUUID(),
            productId: item.productId,
            purchaseOrderItemId: item.purchaseOrderItemId ?? null,
            receivedQuantity: item.receivedQuantity,
            lotNumber: item.lotNumber ?? null,
            expirationDate: item.expirationDate ? new Date(item.expirationDate) : null,
            realUnitCost: new Prisma.Decimal(item.realUnitCost),
            taxSchemeId: item.taxSchemeId,
            taxRate: new Prisma.Decimal(item.taxRate),
            discountAmount: new Prisma.Decimal(item.discountAmount ?? 0),
            subtotal: lineSubtotal,
            taxAmount,
            total: lineSubtotal.plus(taxAmount),
          };
        }),
      );

      // Calculate totals
      const { subtotal, totalTax, totalAmount } =
        this.calculateTotals(itemsData);
      const sequentialNumber = await this.getNextSequentialNumber(tx);

      const reception = await tx.purchaseReception.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          sequentialNumber,
          state: PurchaseReceptionState.DRAFT,
          supplierId: input.supplierId,
          purchaseOrderId: input.purchaseOrderId ?? null,
          notes: input.notes ?? null,
          subtotal,
          totalTax,
          totalAmount,
          createdById: session.userId,
          items: { create: itemsData },
        },
        include: {
          supplier: { select: { id: true, businessName: true } },
          purchaseOrder: { select: { id: true, sequentialNumber: true, state: true } },
          items: true,
        },
      });

      return this.mapReception(reception, reception.items);
    });
  }

  /**
   * Confirm a DRAFT purchase reception — commits stock, creates inventory
   * movements, updates linked purchase order, and creates a SyncQueue entry
   * for server-side reconciliation.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * ## Stock mutations
   * For each item, a Lot is found or created using the provided lot number
   * and expiration date. Stock is incremented with optimistic locking via
   * the `version` column.
   *
   * @throws PurchaseReceptionNotFoundException
   * @throws PurchaseReceptionNotDraftException
   * @throws ConcurrentStockModificationException
   */
  async confirmReception(id: string): Promise<ReceptionResult> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );
    const confirmedAt = new Date();

    return this.prisma.$transaction(async (tx) => {
      // 1. Validate reception exists and is draft
      const reception = await tx.purchaseReception.findUnique({
        where: { id },
        include: {
          items: { include: { purchaseOrderItem: true } },
          purchaseOrder: { include: { items: true } },
        },
      });
      if (!reception) throw new PurchaseReceptionNotFoundException(id);
      if (reception.state !== PurchaseReceptionState.DRAFT) {
        throw new PurchaseReceptionNotDraftException(id, reception.state);
      }

      // 2. For each item, create/update lot and record movement
      for (const item of reception.items) {
        if (!item.expirationDate) {
          throw new Error(`Item ${item.id} is missing expiration date — required for lot creation.`);
        }

        // Resolve the lot: find existing or create new
        const lot = await this.resolveLot(tx, {
          productId: item.productId,
          lotNumber: item.lotNumber ?? `REC-${reception.sequentialNumber}`,
          expirationDate: item.expirationDate,
        });

        // Optimistic-locked stock increment
        const newStock = lot.currentStock + item.receivedQuantity;
        const updated = await tx.lot.updateMany({
          where: { id: lot.id, version: lot.version },
          data: {
            currentStock: newStock,
            version: { increment: 1 },
            state: LotState.ACTIVE,
          },
        });
        if (updated.count === 0) {
          throw new ConcurrentStockModificationException(lot.id);
        }

        // Record inventory movement
        await tx.inventoryMovement.create({
          data: {
            id: globalThis.crypto.randomUUID(),
            lotId: lot.id,
            movementType: MovementType.PURCHASE_RECEIPT,
            quantity: item.receivedQuantity,
            previousStock: lot.currentStock,
            resultingStock: newStock,
            createdById: session.userId,
            createdAt: confirmedAt,
            purchaseReceptionId: reception.id,
          },
        });

        // Link lot to reception item
        await tx.purchaseReceptionItem.update({
          where: { id: item.id },
          data: { lotId: lot.id },
        });

        // Update linked purchase order item if present
        if (item.purchaseOrderItemId) {
          const poItem = item.purchaseOrderItem;
          if (poItem) {
            const newReceived = poItem.receivedQuantity + item.receivedQuantity;
            const newPending = Math.max(0, poItem.requestedQuantity - newReceived);
            await tx.purchaseOrderItem.update({
              where: { id: item.purchaseOrderItemId },
              data: {
                receivedQuantity: newReceived,
                pendingQuantity: newPending,
              },
            });
          }
        }
      }

      // 3. Update linked purchase order state
      if (reception.purchaseOrder) {
        const po = reception.purchaseOrder;
        const allItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: po.id },
        });
        const hasPendingItems = allItems.some((i) => i.pendingQuantity > 0);
        const newOrderState = hasPendingItems
          ? PurchaseOrderState.PARTIALLY_RECEIVED
          : PurchaseOrderState.FULLY_RECEIVED;

        if (po.state !== newOrderState) {
          await tx.purchaseOrder.update({
            where: { id: po.id },
            data: { state: newOrderState },
          });
        }
      }

      // 4. Transition reception to CONFIRMED
      const updated = await tx.purchaseReception.update({
        where: { id },
        data: {
          state: PurchaseReceptionState.CONFIRMED,
          receivedAt: confirmedAt,
        },
        include: {
          supplier: { select: { id: true, businessName: true } },
          purchaseOrder: { select: { id: true, sequentialNumber: true, state: true } },
          items: true,
        },
      });

      // 5. Create SyncQueue entry
      await this.createSyncQueueEntry(tx, reception, session, confirmedAt);

      return this.mapReception(updated, updated.items);
    });
  }

  /**
   * Get purchase order items formatted as default reception items.
   *
   * Pre-populates supplier, items, and costs from a confirmed/pending PO
   * so the user doesn't re-enter data when receiving goods.
   *
   * Returns items ready to use in `CreateReceptionInput.items`.
   * Lot/batch and expiration fields are left blank — the user fills them
   * at reception time.
   *
   * @throws PurchaseOrderNotFoundException
   */
  async getOrderItemsForReception(
    orderId: string,
  ): Promise<{ supplierId: string; notes: string | null; items: CreateReceptionItemInput[] }> {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new PurchaseOrderNotFoundException(orderId);

    // Look up default tax scheme for fallback
    const defaultTaxScheme = await this.prisma.taxScheme.findFirst({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, rate: true },
    });

    const items: CreateReceptionItemInput[] = order.items.map((item) => ({
      productId: item.productId,
      purchaseOrderItemId: item.id,
      receivedQuantity: item.pendingQuantity, // default = still pending
      lotNumber: undefined,
      expirationDate: undefined,
      realUnitCost: Number(item.expectedUnitCost),
      taxSchemeId: defaultTaxScheme?.id ?? '',
      taxRate: defaultTaxScheme ? Number(defaultTaxScheme.rate) : 0,
      discountAmount: 0,
    }));

    return {
      supplierId: order.supplierId,
      notes: order.notes,
      items,
    };
  }

  /**
   * Annul a CONFIRMED purchase reception — reverses all stock changes,
   * reverts linked purchase order items, and transitions to ANNULLED.
   *
   * Requires ADMIN role.
   *
   * @throws PurchaseReceptionNotFoundException
   * @throws PurchaseReceptionNotConfirmedException
   */
  async annulReception(id: string): Promise<ReceptionResult> {
    const session = this.auth.requireRole(RoleType.ADMIN);

    return this.prisma.$transaction(async (tx) => {
      const reception = await tx.purchaseReception.findUnique({
        where: { id },
        include: {
          items: { include: { purchaseOrderItem: true } },
          purchaseOrder: { include: { items: true } },
        },
      });
      if (!reception) throw new PurchaseReceptionNotFoundException(id);
      if (reception.state !== PurchaseReceptionState.CONFIRMED) {
        throw new PurchaseReceptionNotConfirmedException(id);
      }

      // Reverse stock for each item
      for (const item of reception.items) {
        if (!item.lotId) continue;

        const lot = await tx.lot.findUnique({ where: { id: item.lotId } });
        if (!lot) continue;

        const newStock = Math.max(0, lot.currentStock - item.receivedQuantity);
        const newState: LotState =
          newStock <= 0 ? LotState.EXHAUSTED : lot.state as LotState;

        const updated = await tx.lot.updateMany({
          where: { id: item.lotId, version: lot.version },
          data: {
            currentStock: newStock,
            version: { increment: 1 },
            state: newState,
          },
        });
        if (updated.count === 0) {
          throw new ConcurrentStockModificationException(item.lotId);
        }

        // Record reversal movement
        await tx.inventoryMovement.create({
          data: {
            id: globalThis.crypto.randomUUID(),
            lotId: item.lotId,
            movementType: MovementType.NEGATIVE_ADJUSTMENT,
            quantity: item.receivedQuantity,
            previousStock: lot.currentStock,
            resultingStock: newStock,
            createdById: session.userId,
            createdAt: new Date(),
            reason: `Reversal of purchase reception ${id}`,
            purchaseReceptionId: reception.id,
          },
        });

        // Revert PO item quantities
        if (item.purchaseOrderItemId) {
          await tx.purchaseOrderItem.update({
            where: { id: item.purchaseOrderItemId },
            data: {
              receivedQuantity: { decrement: item.receivedQuantity },
              pendingQuantity: { increment: item.receivedQuantity },
            },
          });
        }
      }

      // Revert purchase order state if linked
      if (reception.purchaseOrder) {
        const allItems = await tx.purchaseOrderItem.findMany({
          where: { purchaseOrderId: reception.purchaseOrder.id },
        });
        const hasAnyReceived = allItems.some((poi) => poi.receivedQuantity > 0);
        const newOrderState = hasAnyReceived
          ? PurchaseOrderState.PARTIALLY_RECEIVED
          : PurchaseOrderState.CONFIRMED;
        if (reception.purchaseOrder.state !== newOrderState) {
          await tx.purchaseOrder.update({
            where: { id: reception.purchaseOrder.id },
            data: { state: newOrderState },
          });
        }
      }

      const updated = await tx.purchaseReception.update({
        where: { id },
        data: {
          state: PurchaseReceptionState.ANNULLED,
          annulledAt: new Date(),
          annulledById: session.userId,
        },
        include: {
          supplier: { select: { id: true, businessName: true } },
          purchaseOrder: { select: { id: true, sequentialNumber: true, state: true } },
          items: true,
        },
      });

      return this.mapReception(updated, updated.items);
    });
  }

  // ---------------------------------------------------------------------------
  // Private — lot resolution
  // ---------------------------------------------------------------------------

  /**
   * Find an existing lot for the given product/batch, or create one.
   */
  private async resolveLot(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      lotNumber: string;
      expirationDate: Date;
    },
  ): Promise<{ id: string; currentStock: number; version: number }> {
    // Try to find existing active lot with same batch number
    const existing = await tx.lot.findFirst({
      where: {
        productId: params.productId,
        batchNumber: params.lotNumber,
        state: LotState.ACTIVE,
      },
      select: { id: true, currentStock: true, version: true },
    });
    if (existing) return existing;

    // Also check exhausted lots with same batch — reactivate if found
    const exhausted = await tx.lot.findFirst({
      where: {
        productId: params.productId,
        batchNumber: params.lotNumber,
        state: LotState.EXHAUSTED,
      },
      select: { id: true, currentStock: true, version: true },
    });
    if (exhausted) return exhausted;

    // Create new lot
    const newLot = await tx.lot.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        productId: params.productId,
        batchNumber: params.lotNumber,
        expirationDate: params.expirationDate,
        entryDate: new Date(),
        state: LotState.ACTIVE,
        currentStock: 0,
        version: 0,
      },
      select: { id: true, currentStock: true, version: true },
    });
    return newLot;
  }

  // ---------------------------------------------------------------------------
  // Private — sync
  // ---------------------------------------------------------------------------

  private async createSyncQueueEntry(
    tx: Prisma.TransactionClient,
    reception: {
      id: string;
      sequentialNumber: number;
      supplierId: string;
      purchaseOrderId: string | null;
      notes: string | null;
      createdById: string;
    },
    session: { userId: string; workstationId: string },
    confirmedAt: Date,
  ): Promise<void> {
    const payload = JSON.stringify({
      operationType: 'PURCHASE_RECEPTION_CONFIRMATION',
      receptionId: reception.id,
      sequentialNumber: reception.sequentialNumber,
      supplierId: reception.supplierId,
      purchaseOrderId: reception.purchaseOrderId,
      notes: reception.notes,
      createdById: reception.createdById,
      confirmedByUserId: session.userId,
      workstationId: session.workstationId,
      confirmedAt: confirmedAt.toISOString(),
    });

    const payloadBytes = new TextEncoder().encode(payload);
    const payloadHash = await this.computeHash(payload);

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
        operationType: SyncOperationType.PURCHASE_RECEPTION_CONFIRMATION,
        payload,
        payloadHash,
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
  // Private — numeric helpers
  // ---------------------------------------------------------------------------

  private async getNextSequentialNumber(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const latest = await tx.purchaseReception.findFirst({
      orderBy: { sequentialNumber: 'desc' },
      select: { sequentialNumber: true },
    });
    return (latest?.sequentialNumber ?? 0) + 1;
  }

  private calculateTotals(
    items: Array<{
      realUnitCost: Prisma.Decimal;
      receivedQuantity: number;
      discountAmount: Prisma.Decimal;
      taxRate: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      subtotal: Prisma.Decimal;
    }>,
  ): { subtotal: Prisma.Decimal; totalTax: Prisma.Decimal; totalAmount: Prisma.Decimal } {
    const subtotal = items.reduce(
      (sum, item) => sum.plus(item.subtotal),
      new Prisma.Decimal(0),
    );
    const totalTax = items.reduce(
      (sum, item) => sum.plus(item.taxAmount),
      new Prisma.Decimal(0),
    );
    const totalAmount = subtotal.plus(totalTax);
    return { subtotal, totalTax, totalAmount };
  }

  // ---------------------------------------------------------------------------
  // Private — mapper
  // ---------------------------------------------------------------------------

  private mapReception(
    reception: {
      id: string;
      sequentialNumber: number;
      state: string;
      supplierId: string;
      supplier: { id: string; businessName: string };
      purchaseOrderId: string | null;
      purchaseOrder: { id: string; sequentialNumber: number; state: string } | null;
      notes: string | null;
      subtotal: Prisma.Decimal;
      totalTax: Prisma.Decimal;
      totalAmount: Prisma.Decimal;
      createdAt: Date;
      createdById: string;
      receivedAt: Date | null;
    },
    items: Array<{
      id: string;
      productId: string;
      purchaseOrderItemId: string | null;
      lotId: string | null;
      receivedQuantity: number;
      lotNumber: string | null;
      expirationDate: Date | null;
      realUnitCost: Prisma.Decimal;
      taxSchemeId: string;
      taxRate: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      total: Prisma.Decimal;
    }>,
  ): ReceptionResult {
    return {
      id: reception.id,
      sequentialNumber: reception.sequentialNumber,
      state: reception.state,
      supplierId: reception.supplierId,
      supplier: reception.supplier,
      purchaseOrderId: reception.purchaseOrderId,
      purchaseOrder: reception.purchaseOrder,
      notes: reception.notes,
      subtotal: Number(reception.subtotal),
      totalTax: Number(reception.totalTax),
      totalAmount: Number(reception.totalAmount),
      createdAt: reception.createdAt.toISOString(),
      createdById: reception.createdById,
      receivedAt: reception.receivedAt?.toISOString() ?? null,
      items: items.map((item) => ({
        id: item.id,
        productId: item.productId,
        purchaseOrderItemId: item.purchaseOrderItemId,
        lotId: item.lotId,
        receivedQuantity: item.receivedQuantity,
        lotNumber: item.lotNumber,
        expirationDate: item.expirationDate?.toISOString() ?? null,
        realUnitCost: Number(item.realUnitCost),
        taxSchemeId: item.taxSchemeId,
        taxRate: Number(item.taxRate),
        discountAmount: Number(item.discountAmount),
        subtotal: Number(item.subtotal),
        total: Number(item.total),
      })),
    };
  }
}
