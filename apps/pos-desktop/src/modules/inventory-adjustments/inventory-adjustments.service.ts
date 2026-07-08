/**
 * Local inventory-adjustments service for the POS desktop app.
 *
 * Allows manual stock corrections (positive or negative adjustments) to be
 * recorded locally and synced to the server for authoritative processing.
 *
 * ## Architecture notes
 *
 * ### Local vs server authority
 * The local POS records adjustments in DRAFT state and syncs them as
 * INVENTORY_ADJUSTMENT operations. The server re-validates every constraint
 * against its authoritative state and processes the adjustment through its
 * own approval chain (Phase 16). The local record serves as an offline
 * buffer and audit trail, not as an authority.
 *
 * ### Stock application
 * Positive adjustments increment stock on the FIRST available lot (by FEFO
 * order, then by entry date). Negative adjustments decrement stock across
 * lots in FEFO order, matching the `consumeStockForSale` pattern. Each lot
 * mutation uses optimistic locking via the `version` column.
 *
 * ### Sync integration
 * On confirmation, a SyncQueue row (operationType: INVENTORY_ADJUSTMENT) is
 * created inside the same transaction, carrying the full adjustment details
 * for server-side replay.
 */
import { PrismaClient, Prisma, AdjustmentState, LotState, MovementType } from '@pharmacy/database/local';
import type { AuthService } from '../auth/auth.service';
import { RoleType } from '@pharmacy/shared-types';
import {
  AdjustmentNotFoundException,
  AdjustmentNotInDraftException,
  NoLotsForProductException,
  AdjustmentExceedsAvailableStockException,
  AdjustmentLotConflictException,
} from './exceptions';

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

export interface AdjustmentItemInput {
  productId: string;
  /** Positive for stock increases, negative for decreases. */
  quantity: number;
  /** Optional lot override. For positive adjustments: which lot to add to.
   *  For negative adjustments: which lot to take from (default = FEFO). */
  lotId?: string;
  reason?: string;
}

export interface CreateAdjustmentInput {
  items: AdjustmentItemInput[];
  notes?: string;
  reason?: string;
}

export interface LotSearchResult {
  /** Lot UUID. */
  id: string;
  /** Product UUID. */
  productId: string;
  /** Commercial name from the Product table. */
  productName: string;
  /** Batch number (lot code). */
  lotCode: string;
  /** Current stock count. */
  currentStock: number;
  /** Expiration date as YYYY-MM-DD. */
  expirationDate: string;
  /** Physical location in the pharmacy (e.g. \"Estante A-12\"). */
  location: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createInventoryAdjustmentsService = (
  prisma: PrismaClient,
  auth: AuthService,
): InventoryAdjustmentsService => {
  return new InventoryAdjustmentsService(prisma, auth);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class InventoryAdjustmentsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
  ) {}

  /**
   * Search for active lots by product name (commercial, generic, active
   * principle) or batch number.
   *
   * ✅ Real Prisma query — no mock data, no fallback.
   *
   * Searches the Lot table joined with Product, filtering by:
   * - `product.commercialName` (contains, case-insensitive)
   * - `product.genericName` (contains, case-insensitive)
   * - `product.activePrinciple` (contains, case-insensitive)
   * - `lot.batchNumber` (contains, case-insensitive)
   *
   * Only returns lots in ACTIVE state.
   *
   * @returns An array of matching lots (empty if none found or query is empty).
   */
  async searchLots(query: string): Promise<LotSearchResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const q = trimmed.toLowerCase();

    const lots = await this.prisma.lot.findMany({
      where: {
        state: LotState.ACTIVE,
        OR: [
          { batchNumber: { contains: q, mode: 'insensitive' } },
          { product: { commercialName: { contains: q, mode: 'insensitive' } } },
          { product: { genericName: { contains: q, mode: 'insensitive' } } },
          { product: { activePrinciple: { contains: q, mode: 'insensitive' } } },
        ],
      },
      include: {
        product: {
          select: { commercialName: true },
        },
      },
      orderBy: [
        { expirationDate: 'asc' },
      ],
    });

    return lots.map((lot) => ({
      id: lot.id,
      productId: lot.productId,
      productName: lot.product.commercialName,
      lotCode: lot.batchNumber,
      currentStock: lot.currentStock,
      expirationDate: lot.expirationDate.toISOString().split('T')[0],
      location: lot.locationCode ?? '',
    }));
  }

  /**
   * Create an inventory adjustment document in DRAFT state.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * Validates that:
   * - For negative adjustments, there is sufficient stock across all lots.
   * - For negative adjustments with a specific lotId, that lot has enough stock.
   *
   * Creates the document but does NOT apply stock changes (that happens
   * on `apply`).
   */
  async create(input: CreateAdjustmentInput): Promise<unknown> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    return this.prisma.$transaction(async (tx) => {
      // Pre-validate all items
      for (const item of input.items) {
        if (item.quantity < 0) {
          const absoluteQty = Math.abs(item.quantity);

          if (item.lotId) {
            const lot = await tx.lot.findUnique({
              where: { id: item.lotId, productId: item.productId },
              select: { currentStock: true },
            });
            if (!lot || lot.currentStock < absoluteQty) {
              throw new AdjustmentExceedsAvailableStockException(
                item.productId,
                absoluteQty,
                lot?.currentStock ?? 0,
              );
            }
          } else {
            // Check total available across all lots
            const lots = await tx.lot.findMany({
              where: { productId: item.productId, state: LotState.ACTIVE },
              select: { currentStock: true },
            });
            const totalAvailable = lots.reduce((sum, l) => sum + l.currentStock, 0);
            if (totalAvailable < absoluteQty) {
              throw new AdjustmentExceedsAvailableStockException(
                item.productId,
                absoluteQty,
                totalAvailable,
              );
            }
          }
        }
      }

      // Generate sequential number
      const latestSeq = await tx.inventoryAdjustmentDocument.findFirst({
        orderBy: { sequentialNumber: 'desc' },
        select: { sequentialNumber: true },
      });
      const sequentialNumber = latestSeq ? latestSeq.sequentialNumber + 1 : 1;

      // Create the adjustment document (DRAFT, no stock movement yet)
      const adjustment = await tx.inventoryAdjustmentDocument.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          sequentialNumber,
          state: AdjustmentState.DRAFT,
          reason: input.reason ?? null,
          notes: input.notes ?? null,
          createdByUserId: session.userId,
        },
      });

      return adjustment;
    });
  }

  /**
   * Apply a DRAFT adjustment — commit stock changes and sync.
   *
   * Requires INVENTORY_ASSISTANT or ADMIN role.
   *
   * 1. Validates the adjustment exists and is in DRAFT state.
   * 2. For each item, reads the input again from the transaction (the items
   *    are re-validated against current stock levels to catch races).
   * 3. Applies stock changes with optimistic locking.
   * 4. Writes InventoryMovement records.
   * 5. Transitions to APPLIED.
   * 6. Inserts a SyncQueue row (operationType: INVENTORY_ADJUSTMENT).
   *
   * @throws AdjustmentNotFoundException if the adjustment does not exist.
   * @throws AdjustmentNotInDraftException if not DRAFT.
   * @throws NoLotsForProductException if a positive adjustment has no lot to add to.
   * @throws AdjustmentExceedsAvailableStockException if negative adjustment exceeds stock.
   * @throws AdjustmentLotConflictException if a lot version conflict occurs.
   */
  async apply(
    adjustmentId: string,
    input: CreateAdjustmentInput,
  ): Promise<unknown> {
    const session = this.auth.requireRole(
      RoleType.INVENTORY_ASSISTANT,
      RoleType.ADMIN,
    );

    return this.prisma.$transaction(async (tx) => {
      // 1. Validate adjustment document
      const adjustment = await tx.inventoryAdjustmentDocument.findUnique({
        where: { id: adjustmentId },
      });
      if (!adjustment) throw new AdjustmentNotFoundException(adjustmentId);
      if (adjustment.state !== AdjustmentState.DRAFT) {
        throw new AdjustmentNotInDraftException(adjustmentId, adjustment.state);
      }

      // 2. Process each item with fresh stock reads
      for (const item of input.items) {
        if (item.quantity > 0) {
          // POSITIVE adjustment: add stock to the specified lot or first available
          await this.applyPositiveAdjustment(tx, {
            productId: item.productId,
            quantity: item.quantity,
            lotId: item.lotId,
            reason: item.reason ?? null,
            adjustmentId: adjustment.id,
            userId: session.userId,
          });
        } else if (item.quantity < 0) {
          // NEGATIVE adjustment: remove stock in FEFO order
          await this.applyNegativeAdjustment(tx, {
            productId: item.productId,
            quantity: Math.abs(item.quantity),
            lotId: item.lotId,
            reason: item.reason ?? null,
            adjustmentId: adjustment.id,
            userId: session.userId,
          });
        }
      }

      // 3. Transition to APPLIED
      const appliedAt = new Date();
      const updated = await tx.inventoryAdjustmentDocument.update({
        where: { id: adjustmentId },
        data: {
          state: AdjustmentState.APPLIED,
          appliedAt,
        },
      });

      // 4. Insert SyncQueue entry inside the same transaction
      await this.createSyncQueueEntry(tx, adjustment, input, session, appliedAt);

      return updated;
    });
  }

  // -----------------------------------------------------------------------
  // Private — stock application
  // -----------------------------------------------------------------------

  private async applyPositiveAdjustment(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      quantity: number;
      lotId?: string;
      reason: string | null;
      adjustmentId: string;
      userId: string;
    },
  ): Promise<void> {
    // Find or select the target lot
    let lot: { id: string; currentStock: number; version: number; state: string } | null = null;

    if (params.lotId) {
      lot = await tx.lot.findUnique({
        where: { id: params.lotId, productId: params.productId },
        select: { id: true, currentStock: true, version: true, state: true },
      });
    } else {
      // Select first ACTIVE lot for this product (by expiry, then entry)
      const lots = await tx.lot.findMany({
        where: { productId: params.productId, state: LotState.ACTIVE },
        orderBy: [{ expirationDate: 'asc' }, { entryDate: 'asc' }],
        select: { id: true, currentStock: true, version: true, state: true },
        take: 1,
      });
      lot = lots[0] ?? null;
    }

    if (!lot) {
      throw new NoLotsForProductException(params.productId);
    }

    const newStock = lot.currentStock + params.quantity;
    const newVersion = lot.version + 1;

    const updated = await tx.lot.updateMany({
      where: {
        id: lot.id,
        version: lot.version,
        productId: params.productId,
      },
      data: {
        currentStock: newStock,
        version: newVersion,
        state: newStock > 0 && lot.state === 'EXHAUSTED' ? LotState.ACTIVE : lot.state,
      },
    });

    if (updated.count === 0) {
      throw new AdjustmentLotConflictException(lot.id);
    }

    await tx.inventoryMovement.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        lotId: lot.id,
        movementType: MovementType.POSITIVE_ADJUSTMENT,
        quantity: params.quantity,
        previousStock: lot.currentStock,
        resultingStock: newStock,
        createdById: params.userId,
        createdAt: new Date(),
        adjustmentDocumentId: params.adjustmentId,
        reason: params.reason,
      },
    });
  }

  private async applyNegativeAdjustment(
    tx: Prisma.TransactionClient,
    params: {
      productId: string;
      quantity: number;
      lotId?: string;
      reason: string | null;
      adjustmentId: string;
      userId: string;
    },
  ): Promise<void> {
    let remainingToRemove = params.quantity;

    if (params.lotId) {
      // Remove from a specific lot
      const lot = await tx.lot.findUnique({
        where: { id: params.lotId, productId: params.productId },
        select: { id: true, currentStock: true, version: true, state: true },
      });
      if (!lot || lot.currentStock < remainingToRemove) {
        throw new AdjustmentExceedsAvailableStockException(
          params.productId,
          remainingToRemove,
          lot?.currentStock ?? 0,
        );
      }

      const newStock = lot.currentStock - remainingToRemove;
      const newVersion = lot.version + 1;
      const newState: LotState =
        newStock === 0 ? LotState.EXHAUSTED : lot.state as LotState;

      const updated = await tx.lot.updateMany({
        where: { id: lot.id, version: lot.version },
        data: { currentStock: newStock, version: newVersion, state: newState },
      });

      if (updated.count === 0) {
        throw new AdjustmentLotConflictException(lot.id);
      }

      await tx.inventoryMovement.create({
        data: {
          id: globalThis.crypto.randomUUID(),
          lotId: lot.id,
          movementType: MovementType.NEGATIVE_ADJUSTMENT,
          quantity: remainingToRemove,
          previousStock: lot.currentStock,
          resultingStock: newStock,
          createdById: params.userId,
          createdAt: new Date(),
          adjustmentDocumentId: params.adjustmentId,
          reason: params.reason,
        },
      });
    } else {
      // Remove in FEFO order across all active lots
      const lots = await tx.lot.findMany({
        where: { productId: params.productId, state: LotState.ACTIVE, currentStock: { gt: 0 } },
        orderBy: { expirationDate: 'asc' },
      });

      const totalAvailable = lots.reduce((sum, l) => sum + l.currentStock, 0);
      if (totalAvailable < remainingToRemove) {
        throw new AdjustmentExceedsAvailableStockException(
          params.productId,
          remainingToRemove,
          totalAvailable,
        );
      }

      for (const lot of lots) {
        if (remainingToRemove <= 0) break;

        const takeFromLot = Math.min(remainingToRemove, lot.currentStock);
        const newStock = lot.currentStock - takeFromLot;
        const newVersion = lot.version + 1;
        const newState: LotState =
          newStock === 0 ? LotState.EXHAUSTED : lot.state;

        const updated = await tx.lot.updateMany({
          where: { id: lot.id, version: lot.version },
          data: { currentStock: newStock, version: newVersion, state: newState },
        });

        if (updated.count === 0) {
          throw new AdjustmentLotConflictException(lot.id);
        }

        await tx.inventoryMovement.create({
          data: {
            id: globalThis.crypto.randomUUID(),
            lotId: lot.id,
            movementType: MovementType.NEGATIVE_ADJUSTMENT,
            quantity: takeFromLot,
            previousStock: lot.currentStock,
            resultingStock: newStock,
            createdById: params.userId,
            createdAt: new Date(),
            adjustmentDocumentId: params.adjustmentId,
            reason: params.reason,
          },
        });

        remainingToRemove -= takeFromLot;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Private — sync
  // -----------------------------------------------------------------------

  private async createSyncQueueEntry(
    tx: Prisma.TransactionClient,
    adjustment: { id: string; sequentialNumber: number; reason: string | null; notes: string | null },
    input: CreateAdjustmentInput,
    session: { userId: string; workstationId: string },
    appliedAt: Date,
  ): Promise<void> {
    const payloadObj = {
      adjustmentId: adjustment.id,
      sequentialNumber: adjustment.sequentialNumber,
      reason: adjustment.reason,
      notes: adjustment.notes,
      items: input.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        lotId: item.lotId ?? null,
        reason: item.reason ?? null,
      })),
      metadata: {
        userId: session.userId,
        workstationId: session.workstationId,
        appliedAt: appliedAt.toISOString(),
      },
    };

    const payload = JSON.stringify(payloadObj);
    const payloadBytes = new TextEncoder().encode(payload);
    const payloadSize = payloadBytes.length;
    const payloadHash = await this.computePayloadHash(payload);
    const operationUuid = globalThis.crypto.randomUUID();

    const latestSeq = await tx.syncQueue.findFirst({
      where: { sourceWorkstationId: session.workstationId },
      orderBy: { clientSequence: 'desc' },
      select: { clientSequence: true },
    });
    const clientSequence = latestSeq ? latestSeq.clientSequence + 1n : 1n;

    await tx.syncQueue.create({
      data: {
        id: globalThis.crypto.randomUUID(),
        operationUuid,
        operationType: 'INVENTORY_ADJUSTMENT',
        payload,
        payloadHash,
        payloadSize,
        versionSchema: 1,
        status: 'PENDING',
        retryCount: 0,
        sourceWorkstationId: session.workstationId,
        sourceCreatedAt: appliedAt,
        clientSequence,
      },
    });
  }

  private async computePayloadHash(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
}
