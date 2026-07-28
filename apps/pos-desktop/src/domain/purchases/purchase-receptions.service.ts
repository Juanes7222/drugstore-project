/**
 * Local purchase-receptions service for the offline-first POS.
 *
 * A purchase reception records the physical receipt of inventory from a
 * supplier.  On confirmation, stock is added to lots, inventory movements
 * are recorded, the product's weighted average cost (CPP) is recalculated,
 * and a SyncQueue entry is created for server-side reconciliation.
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
import { notifyPendingEntry } from '../sync/sync-queue-notifier';
import {
  SupplierNotFoundException,
  PurchaseReceptionNotFoundException,
  PurchaseReceptionNotDraftException,
  PurchaseReceptionNotConfirmedException,
  PurchaseOrderNotFoundException,
  PurchaseOrderItemNotFoundException,
  PurchaseOrderItemMismatchException,
  ConcurrentStockModificationException,
  ProductNotFoundException,
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

/**
 * Extended item info returned by getOrderItemsForReception.
 * Carries display fields (productName, requestedQuantity) that
 * CreateReceptionItemInput doesn't have, so the inline receive
 * form can show the user what they're receiving.
 */
export interface ReceptionOrderItem {
  productId: string;
  productName: string;
  /** The purchase-order-item link (if any). */
  purchaseOrderItemId: string;
  /** Quantity originally ordered. */
  requestedQuantity: number;
  /** Quantity still pending from the PO item. */
  pendingQuantity: number;
  /** Pre-filled quantity to receive (defaults to pending). */
  receivedQuantity: number;
  lotNumber?: string;
  expirationDate?: string;
  realUnitCost: number;
  taxSchemeId: string;
  taxRate: number;
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
  productName: string;
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

    // Batch-fetch product names for all items across all receptions
    const allProductIds = receptions.flatMap((r) => r.items.map((i) => i.productId));
    const productNameMap = await this.fetchProductNameMap(allProductIds);

    return {
      data: receptions.map((r) => this.mapReception(r, r.items, productNameMap)),
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

    const productIds = reception.items.map((i) => i.productId);
    const productNameMap = await this.fetchProductNameMap(productIds);

    return this.mapReception(reception, reception.items, productNameMap);
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

    const reception = await this.prisma.$transaction(async (tx) => {
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

      return tx.purchaseReception.create({
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
    });

    const productIds = reception.items.map((i) => i.productId);
    const productNameMap = await this.fetchProductNameMap(productIds);

    return this.mapReception(reception, reception.items, productNameMap);
  }

  /**
   * Confirm a DRAFT purchase reception — commits stock, creates inventory
   * movements, recalculates product CPP (weighted average cost), updates
   * linked purchase order, and creates a SyncQueue entry for server-side
   * reconciliation.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * ## Stock mutations
   * For each item, a Lot is found or created using the provided lot number
   * and expiration date. Stock is incremented with optimistic locking via
   * the `version` column.
   *
   * ## CPP recalculation (RF-COM-35 / RF-COM-36)
   * After all stock updates, the weighted average cost for each product
   * in the reception is recalculated using:
   *   CPP_nuevo = (stock_anterior × CPP_anterior + cantidad_recibida × costo_recibido)
   *             / (stock_anterior + cantidad_recibida)
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

    const updated = await this.prisma.$transaction(async (tx) => {
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

      // 2a. Collect pre-update stock/cost per product for CPP calculation
      //     Group reception items by product to know total received per product
      const productReceivedQuantities = new Map<string, number>();
      const productReceivedCosts = new Map<string, Prisma.Decimal>();
      for (const item of reception.items) {
        const prevQty = productReceivedQuantities.get(item.productId) ?? 0;
        productReceivedQuantities.set(item.productId, prevQty + item.receivedQuantity);
        // Use the first item's cost per product (all items of same product in one reception
        // should have the same realUnitCost; if not, the last one wins — conservative choice)
        productReceivedCosts.set(item.productId, item.realUnitCost);
      }

      // Fetch current product costs and total stock per product (pre-update)
      const productCostMap = new Map<string, string | null>();
      const productStockMap = new Map<string, number>();
      for (const productId of productReceivedQuantities.keys()) {
        // Get current cost from product's active cost history
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: {
            currentCostId: true,
            costHistories: {
              where: { effectiveTo: null },
              select: { cost: true },
              take: 1,
            },
          },
        });
        if (!product) throw new ProductNotFoundException(productId);
        productCostMap.set(productId, product.costHistories[0]?.cost.toString() ?? null);

        // Get total stock across all lots for this product (pre-update)
        const lotsAgg = await tx.lot.aggregate({
          where: { productId },
          _sum: { currentStock: true },
        });
        productStockMap.set(productId, lotsAgg._sum.currentStock ?? 0);
      }

      // 2b. For each item, create/update lot and record movement
      for (const item of reception.items) {
        // Resolve the lot: find existing or create new
        // When no lotNumber is provided, generate an internal one so stock
        // tracking still works — the UI layer decides whether to require one.
        const lotExpiration = item.expirationDate ?? new Date(
          Date.now() + 365 * 24 * 60 * 60 * 1000,
        );
        const lot = await this.resolveLot(tx, {
          productId: item.productId,
          lotNumber: item.lotNumber ?? `REC-${reception.sequentialNumber}`,
          expirationDate: lotExpiration,
        });

        // Optimistic-locked stock increment
        const newStock = lot.currentStock + item.receivedQuantity;
        const updatedLot = await tx.lot.updateMany({
          where: { id: lot.id, version: lot.version },
          data: {
            currentStock: newStock,
            version: { increment: 1 },
            state: LotState.ACTIVE,
          },
        });
        if (updatedLot.count === 0) {
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

      // 4. Calculate and update CPP for each product (RF-COM-35 / RF-COM-36)
      //    CPP_nuevo = (stock_anterior × CPP_anterior + cantidad_recibida × costo_recibido)
      //              / (stock_anterior + cantidad_recibida)
      for (const [productId, receivedQty] of productReceivedQuantities) {
        const prevStock = productStockMap.get(productId) ?? 0;
        const prevCostStr = productCostMap.get(productId);
        const receivedCost = productReceivedCosts.get(productId)!;

        const prevCost = prevCostStr
          ? new Prisma.Decimal(prevCostStr)
          : new Prisma.Decimal(0);
        const prevStockD = new Prisma.Decimal(prevStock);
        const receivedQtyD = new Prisma.Decimal(receivedQty);

        // If no prior stock, new CPP = received cost
        // If no prior cost, new CPP = received cost
        let newCost: Prisma.Decimal;
        if (prevStock === 0 || !prevCostStr) {
          newCost = receivedCost;
        } else {
          newCost = prevStockD
            .times(prevCost)
            .plus(receivedQtyD.times(receivedCost))
            .dividedBy(prevStockD.plus(receivedQtyD));
        }

        // Expire current cost history
        const product = await tx.product.findUnique({
          where: { id: productId },
          select: { currentCostId: true },
        });
        if (product?.currentCostId) {
          await tx.productCostHistory.update({
            where: { id: product.currentCostId },
            data: { effectiveTo: confirmedAt },
          });
        }

        // Create new cost history
        const newCostHistoryId = globalThis.crypto.randomUUID();
        await tx.productCostHistory.create({
          data: {
            id: newCostHistoryId,
            productId,
            previousCostHistoryId: product?.currentCostId ?? null,
            cost: newCost,
            effectiveFrom: confirmedAt,
            changedById: session.userId,
            changedAt: confirmedAt,
            changeReason: 'CPP updated after purchase reception confirmation',
          },
        });

        // Update product pointer
        await tx.product.update({
          where: { id: productId },
          data: { currentCostId: newCostHistoryId },
        });
      }

      // 6. Transition reception to CONFIRMED
      const updatedReception = await tx.purchaseReception.update({
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

      // 7. Create SyncQueue entry
      await this.createSyncQueueEntry(tx, reception, session, confirmedAt);

      return updatedReception;
    }).then((result) => {
      notifyPendingEntry();
      return result;
    });

    const productIds = updated.items.map((i) => i.productId);
    const productNameMap = await this.fetchProductNameMap(productIds);

    return this.mapReception(updated, updated.items, productNameMap);
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
  ): Promise<{ supplierId: string; notes: string | null; items: ReceptionOrderItem[] }> {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!order) throw new PurchaseOrderNotFoundException(orderId);

    // Batch-fetch product names and current costs for display & pre-fill
    const productIds = [...new Set(order.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        commercialName: true,
        costHistories: {
          where: { effectiveTo: null },
          select: { cost: true },
          take: 1,
        },
      },
    });
    const productNameMap = new Map(products.map((p) => [p.id, p.commercialName]));
    const productCostMap = new Map(
      products.map((p) => [p.id, p.costHistories[0]?.cost.toString() ?? null]),
    );

    // Look up default tax scheme for fallback
    const defaultTaxScheme = await this.prisma.taxScheme.findFirst({
      where: { isActive: true },
      orderBy: { code: 'asc' },
      select: { id: true, rate: true },
    });

    const items: ReceptionOrderItem[] = order.items.map((item) => {
      const currentCost = productCostMap.get(item.productId);
      return {
        productId: item.productId,
        productName: productNameMap.get(item.productId) ?? '',
        purchaseOrderItemId: item.id,
        requestedQuantity: item.requestedQuantity,
        pendingQuantity: item.pendingQuantity,
        receivedQuantity: item.pendingQuantity, // default = still pending
        lotNumber: undefined,
        expirationDate: undefined,
        // Pre-fill with the last known cost from ProductCostHistory;
        // fall back to the PO's expected unit cost if no history exists.
        realUnitCost: currentCost ? Number(currentCost) : Number(item.expectedUnitCost),
        taxSchemeId: defaultTaxScheme?.id ?? '',
        taxRate: defaultTaxScheme ? Number(defaultTaxScheme.rate) : 0,
      };
    });

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

    const updated = await this.prisma.$transaction(async (tx) => {
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

        const updatedLot = await tx.lot.updateMany({
          where: { id: item.lotId, version: lot.version },
          data: {
            currentStock: newStock,
            version: { increment: 1 },
            state: newState,
          },
        });
        if (updatedLot.count === 0) {
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

      return tx.purchaseReception.update({
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
    });

    const productIds = updated.items.map((i) => i.productId);
    const productNameMap = await this.fetchProductNameMap(productIds);

    return this.mapReception(updated, updated.items, productNameMap);
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
    // Fetch supplier data for server-side upsert (offline-first: supplier may
    // not exist on the server yet)
    const supplier = await tx.supplier.findUnique({
      where: { id: reception.supplierId },
      select: {
        businessName: true,
        identificationType: true,
        identificationNumber: true,
        contactName: true,
        phone: true,
        email: true,
        address: true,
        city: true,
        country: true,
        paymentTermsDays: true,
        creditLimit: true,
      },
    });

    // Fetch reception items with their lot details for the sync payload
    const items = await tx.purchaseReceptionItem.findMany({
      where: { purchaseReceptionId: reception.id },
      select: {
        productId: true,
        receivedQuantity: true,
        realUnitCost: true,
        taxSchemeId: true,
        taxRate: true,
        discountAmount: true,
        lotId: true,
      },
    });

    // Batch-fetch lots for all items that have a lotId
    const lotIds = items
      .map((i) => i.lotId)
      .filter((id): id is string => id !== null);
    const lots = lotIds.length > 0
      ? await tx.lot.findMany({
          where: { id: { in: lotIds } },
          select: {
            id: true,
            batchNumber: true,
            expirationDate: true,
            productId: true,
            currentStock: true,
            locationCode: true,
          },
        })
      : [];
    const lotMap = new Map(lots.map((l) => [l.id, l]));

    const payloadItems = items.map((item) => {
      const lot = item.lotId ? lotMap.get(item.lotId) : undefined;
      return {
        productId: item.productId,
        // JSON keys align with PurchaseReceptionConfirmationItemSchema
        // (apps/server/src/modules/sync/dto/purchase-sync-payloads.schema.ts).
        // Local column / model / form field names stay as `receivedQuantity`
        // and `realUnitCost`; only the sync-payload wire names change.
        quantity: item.receivedQuantity,
        unitCost: Number(item.realUnitCost),
        lot: lot
          ? {
              batchNumber: lot.batchNumber,
              expirationDate: lot.expirationDate.toISOString(),
              productId: lot.productId,
              currentStock: lot.currentStock,
              locationCode: lot.locationCode ?? undefined,
            }
          : undefined,
      };
    });

    const payload = JSON.stringify({
      operationType: 'PURCHASE_RECEPTION_CONFIRMATION',
      receptionId: reception.id,
      sequentialNumber: reception.sequentialNumber,
      supplierId: reception.supplierId,
      supplier: supplier
        ? {
            businessName: supplier.businessName,
            identificationType: supplier.identificationType,
            identificationNumber: supplier.identificationNumber,
            contactName: supplier.contactName ?? undefined,
            phone: supplier.phone ?? undefined,
            email: supplier.email ?? undefined,
            address: supplier.address ?? undefined,
            city: supplier.city ?? undefined,
            country: supplier.country,
            paymentTermsDays: supplier.paymentTermsDays,
            creditLimit: Number(supplier.creditLimit),
          }
        : undefined,
      purchaseOrderId: reception.purchaseOrderId,
      notes: reception.notes,
      createdById: reception.createdById,
      confirmedByUserId: session.userId,
      workstationId: session.workstationId,
      confirmedAt: confirmedAt.toISOString(),
      items: payloadItems,
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
  // Private — product name resolution
  // ---------------------------------------------------------------------------

  /**
   * Batch-fetch Product records for the given product IDs and return
   * a Map<productId, commercialName>.  Missing IDs yield an empty string.
   */
  private async fetchProductNameMap(productIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(productIds)];
    if (unique.length === 0) return new Map();
    const products = await this.prisma.product.findMany({
      where: { id: { in: unique } },
      select: { id: true, commercialName: true },
    });
    return new Map(products.map((p) => [p.id, p.commercialName]));
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
    productNameMap: Map<string, string>,
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
        productName: productNameMap.get(item.productId) ?? '',
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
