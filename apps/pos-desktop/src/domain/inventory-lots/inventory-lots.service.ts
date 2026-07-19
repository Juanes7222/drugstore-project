/**
 * Local inventory-lot operations for the POS desktop app.
 *
 * Ported from the server-side `LotsService.consumeStockForSale()`.
 * Only the primitives that the local POS needs as a single-writer authority
 * are exposed here — stock reversal, receiving, and adjustment are
 * server-authoritative operations not duplicated in this module.
 *
 * ## Architecture notes
 *
 * ### Single-writer assumption
 * The local POS is the only consumer of its own PGlite database.  There are
 * no concurrent backend services, no other POS instances writing to the same
 * database, and no HTTP middleware creating race conditions.  Optimistic
 * locking via the `version` column is therefore a correctness backstop, not
 * a performance trade-off — it catches the unlikely case where a local async
 * workflow (e.g. two sale confirmations enqueued back-to-back) races on the
 * same lot row.  If that happens, the caller retries the entire sale.
 *
 * ### unitCostAtSale — provisional value
 * `PurchaseReceptionItem` (the only place a lot's real cost lives) is a
 * server-only model, deliberately excluded from the local schema.  A locally
 * confirmed sale therefore cannot compute a real `unitCostAtSale`; it stores
 * `0` here, clearly marked as provisional, purely so the sale can be
 * completed and a receipt shown.  This is not a gap to route around:
 * `sync`'s existing design already never trusts a locally computed outcome
 * for a `SALE_CONFIRMATION` operation — it replays `create` and `confirm`
 * against the real server-side services, which resolve the real cost through
 * `PurchaseReceptionItem` exactly as before.  The provisional local figure
 * is discarded and replaced once that replay happens; it was never meant to
 * be authoritative.
 */

import { PrismaClient, Prisma, LotState, MovementType } from '@pharmacy/database/local';
import { InsufficientStockException } from './exceptions';
import { ConcurrentStockModificationException } from './exceptions';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConsumeStockForSaleParams {
  productId: string;
  quantity: number;
  saleId: string;
}

export interface ConsumedLot {
  lotId: string;
  quantity: number;
  /**
   * Provisional zero — see the module-level comment for the rationale.
   * This value is discarded when `sync` replays the sale against the server.
   */
  unitCostAtSale: Prisma.Decimal;
}

// ---------------------------------------------------------------------------
// Movement query types
// ---------------------------------------------------------------------------

/**
 * A single inventory movement record, formatted for display in a UI table.
 *
 * The `createdByName` field is `null` in the local-only context because the
 * `User` model is not included in the local Prisma schema — it exists only
 * in the server schema.  A future sync-layer enhancement could resolve
 * `createdById` via a cached local User table if one is added.
 */
export interface LotMovementRecord {
  id: string;
  movementType: string;
  quantity: number;
  previousStock: number;
  resultingStock: number;
  /** ISO-8601 string of the movement timestamp. */
  createdAt: string;
  reason: string | null;
  createdByName: string | null;
  adjustmentDocumentId: string | null;
  saleId: string | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createInventoryLotsService = (
  prisma: PrismaClient,
): InventoryLotsService => {
  return new InventoryLotsService(prisma);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type LotWithProduct = Prisma.LotGetPayload<{
  include: { product: { select: { commercialName: true; genericName: true; internalCode: true } } };
}>;

export class InventoryLotsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * List all lots ordered by expiration date (ascending — nearest expiry first).
   * Optionally filtered by product ID or search query.
   */
  async getLots(params?: {
    productId?: string;
    search?: string;
    state?: LotState;
  }): Promise<LotWithProduct[]> {
    const where: Prisma.LotWhereInput = {};

    if (params?.productId) {
      where.productId = params.productId;
    }

    if (params?.state) {
      where.state = params.state;
    }

    if (params?.search) {
      const q = params.search;
      where.OR = [
        { batchNumber: { contains: q, mode: 'insensitive' } },
        { product: { commercialName: { contains: q, mode: 'insensitive' } } },
        { product: { genericName: { contains: q, mode: 'insensitive' } } },
        { product: { internalCode: { contains: q, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.lot.findMany({
      where,
      include: {
        product: {
          select: {
            commercialName: true,
            genericName: true,
            internalCode: true,
          },
        },
      },
      orderBy: [{ expirationDate: 'asc' }, { createdAt: 'desc' }],
    });
  }

  /**
   * Get a single lot by ID with full product info.
   */
  async getLotById(id: string): Promise<LotWithProduct | null> {
    return this.prisma.lot.findUnique({
      where: { id },
      include: {
        product: {
          select: {
            commercialName: true,
            genericName: true,
            internalCode: true,
          },
        },
      },
    });
  }

  /**
   * Get expiry summary: count of lots expiring within N days.
   */
  async getExpirySummary(days: number): Promise<{
    expiringSoon: number;
    expired: number;
    active: number;
    totalStock: number;
  }> {
    const now = new Date();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    const [allLots, expiringLots, expiredLots] = await Promise.all([
      this.prisma.lot.findMany({
        where: { state: LotState.ACTIVE },
        select: { currentStock: true },
      }),
      this.prisma.lot.findMany({
        where: {
          state: LotState.ACTIVE,
          expirationDate: { lte: cutoff, gt: now },
        },
        select: { id: true },
      }),
      this.prisma.lot.count({
        where: { expirationDate: { lte: now } },
      }),
    ]);

    return {
      expiringSoon: expiringLots.length,
      expired: expiredLots,
      active: allLots.length,
      totalStock: allLots.reduce((sum, l) => sum + l.currentStock, 0),
    };
  }

  /**
   * Consume stock for a sale using FEFO (First Expiry, First Out) ordering.
   *
   * Selects ACTIVE lots for the given product with stock remaining, ordered
   * by `expirationDate ASC`, and decrements each in turn until the requested
   * `quantity` is satisfied.  Each lot decrement is optimistically locked via
   * the `version` column — if a concurrent modification is detected the
   * entire operation is rolled back and `ConcurrentStockModificationException`
   * is thrown.
   *
   * @throws InsufficientStockException      when total available stock < `quantity`
   * @throws ConcurrentStockModificationException  when a version conflict is detected
   */
  async consumeStockForSale(
    params: ConsumeStockForSaleParams,
    tx?: Prisma.TransactionClient,
  ): Promise<ConsumedLot[]> {
    const { productId, quantity, saleId } = params;

    // When called from inside an existing transaction (e.g. sale confirm),
    // reuse the caller's tx to avoid nested $transaction — PGlite has only
    // one connection and nested transactions would deadlock.
    const run = async (tx: Prisma.TransactionClient) => {
      // 1. Select active, non-empty lots in FEFO order
      const availableLots = await tx.lot.findMany({
        where: {
          productId,
          state: LotState.ACTIVE,
          currentStock: { gt: 0 },
        },
        orderBy: { expirationDate: 'asc' },
      });

      // 2. Check total availability
      const totalAvailable = availableLots.reduce(
        (sum, lot) => sum + lot.currentStock,
        0,
      );

      if (totalAvailable < quantity) {
        throw new InsufficientStockException(productId, quantity, totalAvailable);
      }

      // 3. Consume across lots in FEFO order
      let remainingToConsume = quantity;
      const consumedLots: ConsumedLot[] = [];

      for (const lot of availableLots) {
        if (remainingToConsume === 0) break;

        const consumeFromLot = Math.min(remainingToConsume, lot.currentStock);
        const newStock = lot.currentStock - consumeFromLot;
        const newVersion = lot.version + 1;
        const newState: LotState =
          newStock === 0 ? LotState.EXHAUSTED : lot.state;

        // Optimistic-locked decrement — the `version` filter makes this
        // safe against concurrent local writers.
        const updated = await tx.lot.updateMany({
          where: {
            id: lot.id,
            version: lot.version,
            productId: lot.productId,
          },
          data: {
            currentStock: newStock,
            version: newVersion,
            state: newState,
          },
        });

        if (updated.count === 0) {
          throw new ConcurrentStockModificationException(lot.id);
        }

        // unitCostAtSale is set to 0 because PurchaseReceptionItem is
        // server-only.  See the module-level comment for the full rationale.
        consumedLots.push({
          lotId: lot.id,
          quantity: consumeFromLot,
          unitCostAtSale: new Prisma.Decimal(0),
        });

        // Write the immutable movement record
        await tx.inventoryMovement.create({
          data: {
            id: globalThis.crypto.randomUUID(),
            lotId: lot.id,
            movementType: MovementType.SALE,
            quantity: consumeFromLot,
            previousStock: lot.currentStock,
            resultingStock: newStock,
            createdById: 'system',
            createdAt: new Date(),
            saleId,
          },
        });

        remainingToConsume -= consumeFromLot;
      }

      return consumedLots;
    };

    // Reuse caller's transaction if provided, otherwise create a new one.
    if (tx) {
      return run(tx);
    }
    return this.prisma.$transaction(run);
  }

  /**
   * Retrieve all inventory movements for a given lot, most recent first.
   *
   * Returns plain objects with ISO date strings, ready for direct
   * consumption by a UI table.  The `createdByName` field is always
   * `null` because the `User` model is not available in the local
   * PGlite schema — see `LotMovementRecord` for details.
   */
  async getMovementsForLot(lotId: string): Promise<LotMovementRecord[]> {
    const movements = await this.prisma.inventoryMovement.findMany({
      where: { lotId },
      orderBy: { createdAt: 'desc' },
    });

    return movements.map((m) => ({
      id: m.id,
      movementType: m.movementType,
      quantity: m.quantity,
      previousStock: m.previousStock,
      resultingStock: m.resultingStock,
      createdAt: m.createdAt.toISOString(),
      reason: m.reason,
      createdByName: null,
      adjustmentDocumentId: m.adjustmentDocumentId,
      saleId: m.saleId,
    }));
  }
}
