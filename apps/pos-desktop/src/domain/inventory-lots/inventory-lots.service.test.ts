/**
 * Unit tests for InventoryLotsService — local FEFO stock consumption.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { InventoryLotsService, createInventoryLotsService } from "./inventory-lots.service";
import { InsufficientStockException, ConcurrentStockModificationException } from "./exceptions";
import type { PrismaClient } from "@pharmacy/database/local";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const transaction = vi.fn(async (cb: (tx: any) => unknown) => cb(tx));

  const tx = {
    lot: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    inventoryMovement: {
      create: vi.fn(),
    },
  };

  const prisma = {
    $transaction: transaction,
    lot: tx.lot,
    inventoryMovement: tx.inventoryMovement,
  } as unknown as PrismaClient;

  return { prisma, tx };
};

const makeActiveLot = (overrides: Partial<{
  id: string;
  productId: string;
  currentStock: number;
  version: number;
  expirationDate: Date;
  state: string;
  batchNumber: string;
  locationCode: string | null;
  entryDate: Date;
}> = {}) => ({
  id: "lot-1",
  productId: "prod-1",
  currentStock: 50,
  version: 1,
  expirationDate: new Date("2026-12-31"),
  state: "ACTIVE",
  batchNumber: "BATCH-001",
  locationCode: "A-1",
  entryDate: new Date("2026-01-01"),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InventoryLotsService", () => {
  let prisma: ReturnType<typeof makeMockPrisma>["prisma"];
  let tx: ReturnType<typeof makeMockPrisma>["tx"];
  let service: InventoryLotsService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    service = createInventoryLotsService(prisma);
  });

  describe("consumeStockForSale", () => {
    it("consumes from a single lot when it has enough stock", async () => {
      const lot = makeActiveLot({ id: "lot-1", currentStock: 10, version: 1 });
      tx.lot.findMany.mockResolvedValue([lot]);
      tx.lot.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.consumeStockForSale({
        productId: "prod-1",
        quantity: 3,
        saleId: "sale-1",
      });

      expect(result).toEqual([
        { lotId: "lot-1", quantity: 3, unitCostAtSale: expect.anything() },
      ]);
      expect(tx.lot.updateMany).toHaveBeenCalledWith({
        where: { id: "lot-1", version: 1, productId: "prod-1" },
        data: {
          currentStock: 7,
          version: 2,
          state: "ACTIVE",
        },
      });
      expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1);
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lotId: "lot-1",
            movementType: "SALE",
            quantity: 3,
            saleId: "sale-1",
          }),
        }),
      );
    });

    it("consumes from two lots in FEFO order and returns both consumed lots", async () => {
      const lotA = makeActiveLot({
        id: "lot-a", currentStock: 5, version: 1,
        expirationDate: new Date("2026-06-01"),
      });
      const lotB = makeActiveLot({
        id: "lot-b", currentStock: 10, version: 1,
        expirationDate: new Date("2027-01-01"),
      });
      tx.lot.findMany.mockResolvedValue([lotA, lotB]); // FEFO: lotA expires first
      tx.lot.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.consumeStockForSale({
        productId: "prod-1",
        quantity: 12,
        saleId: "sale-1",
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual(
        expect.objectContaining({ lotId: "lot-a", quantity: 5 }),
      );
      expect(result[1]).toEqual(
        expect.objectContaining({ lotId: "lot-b", quantity: 7 }),
      );
    });

    it("throws InsufficientStockException when total available stock is less than quantity", async () => {
      tx.lot.findMany.mockResolvedValue([
        makeActiveLot({ id: "lot-1", currentStock: 3 }),
      ]);

      await expect(
        service.consumeStockForSale({
          productId: "prod-1",
          quantity: 10,
          saleId: "sale-1",
        }),
      ).rejects.toThrow(InsufficientStockException);
    });

    it("throws ConcurrentStockModificationException when updateMany returns { count: 0 }", async () => {
      const lot = makeActiveLot({ id: "lot-1", currentStock: 10, version: 1 });
      tx.lot.findMany.mockResolvedValue([lot]);
      tx.lot.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.consumeStockForSale({
          productId: "prod-1",
          quantity: 3,
          saleId: "sale-1",
        }),
      ).rejects.toThrow(ConcurrentStockModificationException);
    });

    it("marks a lot as EXHAUSTED when currentStock reaches zero after consumption", async () => {
      const lot = makeActiveLot({
        id: "lot-1", currentStock: 5, version: 1,
      });
      tx.lot.findMany.mockResolvedValue([lot]);
      tx.lot.updateMany.mockResolvedValue({ count: 1 });

      await service.consumeStockForSale({
        productId: "prod-1",
        quantity: 5,
        saleId: "sale-1",
      });

      expect(tx.lot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lot-1", version: 1, productId: "prod-1" },
          data: expect.objectContaining({ state: "EXHAUSTED" }),
        }),
      );
    });

    it("only selects ACTIVE lots and ignores BLOCKED or EXPIRED lots", async () => {
      const activeLot = makeActiveLot({
        id: "lot-active", currentStock: 10, version: 1,
      });
      const expiredLot = makeActiveLot({
        id: "lot-expired", currentStock: 5, version: 1,
        expirationDate: new Date("2025-01-01"),
        state: "EXPIRED",
      });
      tx.lot.findMany.mockResolvedValue([activeLot]); // Only ACTIVE returned
      tx.lot.updateMany.mockResolvedValue({ count: 1 });

      await service.consumeStockForSale({
        productId: "prod-1",
        quantity: 3,
        saleId: "sale-1",
      });

      expect(tx.lot.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ state: "ACTIVE" }),
        }),
      );
    });

    it("writes an inventory movement record for each consumed lot", async () => {
      const lot = makeActiveLot({ id: "lot-1", currentStock: 10, version: 1 });
      tx.lot.findMany.mockResolvedValue([lot]);
      tx.lot.updateMany.mockResolvedValue({ count: 1 });

      await service.consumeStockForSale({
        productId: "prod-1",
        quantity: 3,
        saleId: "sale-1",
      });

      expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lotId: "lot-1",
            movementType: "SALE",
            quantity: 3,
            previousStock: 10,
            resultingStock: 7,
            saleId: "sale-1",
          }),
        }),
      );
    });
  });
});
