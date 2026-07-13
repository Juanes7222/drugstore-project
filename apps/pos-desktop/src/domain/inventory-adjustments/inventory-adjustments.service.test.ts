/**
 * Unit tests for InventoryAdjustmentsService — stock adjustments.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { InventoryAdjustmentsService, createInventoryAdjustmentsService, type CreateAdjustmentInput } from "./inventory-adjustments.service";
import { AdjustmentNotFoundException, AdjustmentNotInDraftException, NoLotsForProductException, AdjustmentExceedsAvailableStockException, AdjustmentLotConflictException } from "./exceptions";
import { RoleType } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    lot: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    inventoryMovement: { create: vi.fn() },
    inventoryAdjustmentDocument: {
      findFirst: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    syncQueue: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    $transaction: transaction,
    lot: tx.lot,
    inventoryMovement: tx.inventoryMovement,
    inventoryAdjustmentDocument: tx.inventoryAdjustmentDocument,
    syncQueue: tx.syncQueue,
  } as any;

  return { prisma, tx };
};

const makeMockAuth = () => ({
  requireRole: vi.fn(),
  getCurrentSession: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  completeTwoFactor: vi.fn(),
  refreshSession: vi.fn(),
  requestStepUp: vi.fn(),
  approveStepUp: vi.fn(),
  verifyStepUp: vi.fn(),
  changePassword: vi.fn(),
  changePin: vi.fn(),
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
  createUser: vi.fn(),
  listUsers: vi.fn(),
  getPendingStepUpRequests: vi.fn(),
  getAuditLogs: vi.fn(),
});

const makeMockSession = () => ({
  userId: "user-1",
  username: "inv1",
  fullName: "Inventory Assistant",
  displayName: "Inventory Assistant",
  email: null,
  role: "INVENTORY_ASSISTANT",
  subscriptionId: null,
  workstationId: "ws-1",
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: new Date("2099-12-31"),
  sessionId: "sess-1",
  totpEnabled: false,
  avatarUrl: null,
  avatarColor: null,
  mustChangePassword: false,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("InventoryAdjustmentsService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: InventoryAdjustmentsService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createInventoryAdjustmentsService(prisma, auth as any);
  });

  describe("searchLots", () => {
    it("returns matching lots by product name", async () => {
      tx.lot.findMany.mockResolvedValue([{
        id: "lot-1",
        productId: "prod-1",
        batchNumber: "B001",
        currentStock: 50,
        expirationDate: new Date("2026-12-31"),
        locationCode: "A-1",
        product: { commercialName: "Acetaminofén" },
      }]);

      const results = await service.searchLots("Acetaminofén");

      expect(results).toHaveLength(1);
      expect(results[0].productName).toBe("Acetaminofén");
    });

    it("returns empty array when query is empty", async () => {
      const results = await service.searchLots("");
      expect(results).toEqual([]);
    });
  });

  describe("create", () => {
    const validInput: CreateAdjustmentInput = {
      items: [{ productId: "prod-1", quantity: 10 }],
      reason: "Ajuste de inventario",
    };

    it("creates a DRAFT adjustment document", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.inventoryAdjustmentDocument.findFirst.mockResolvedValue(null);
      tx.inventoryAdjustmentDocument.create.mockResolvedValue({
        id: "adj-1",
        state: "DRAFT",
        sequentialNumber: 1,
      });

      const result = await service.create(validInput);

      expect(result.state).toBe("DRAFT");
      expect(auth.requireRole).toHaveBeenCalledWith("INVENTORY_ASSISTANT", "ADMIN");
    });

    it("throws AdjustmentExceedsAvailableStockException for negative adjustments exceeding stock", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.lot.findMany.mockResolvedValue([
        { currentStock: 5 },
      ]);

      await expect(
        service.create({
          items: [{ productId: "prod-1", quantity: -10 }],
        }),
      ).rejects.toThrow(AdjustmentExceedsAvailableStockException);
    });
  });

  describe("apply", () => {
    const validInput: CreateAdjustmentInput = {
      items: [{ productId: "prod-1", quantity: 10 }],
    };

    it("applies a positive adjustment to the first available lot", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.inventoryAdjustmentDocument.findUnique.mockResolvedValue({
        id: "adj-1",
        state: "DRAFT",
      });
      tx.lot.findMany.mockResolvedValue([{
        id: "lot-1",
        productId: "prod-1",
        currentStock: 50,
        version: 3,
        state: "ACTIVE",
      }]);
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.inventoryAdjustmentDocument.update.mockResolvedValue({
        id: "adj-1",
        state: "APPLIED",
      });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const result = await service.apply("adj-1", validInput);

      expect(result.state).toBe("APPLIED");
      expect(tx.lot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lot-1", version: 3, productId: "prod-1" },
          data: expect.objectContaining({ currentStock: 60 }),
        }),
      );
    });

    it("throws AdjustmentNotFoundException when adjustment does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.inventoryAdjustmentDocument.findUnique.mockResolvedValue(null);

      await expect(
        service.apply("nonexistent", validInput),
      ).rejects.toThrow(AdjustmentNotFoundException);
    });

    it("throws AdjustmentNotInDraftException when adjustment is not DRAFT", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.inventoryAdjustmentDocument.findUnique.mockResolvedValue({
        id: "adj-1",
        state: "APPLIED",
      });

      await expect(
        service.apply("adj-1", validInput),
      ).rejects.toThrow(AdjustmentNotInDraftException);
    });

    it("throws AdjustmentLotConflictException when optimistic lock fails", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.inventoryAdjustmentDocument.findUnique.mockResolvedValue({
        id: "adj-1",
        state: "DRAFT",
      });
      tx.lot.findMany.mockResolvedValue([{
        id: "lot-1",
        productId: "prod-1",
        currentStock: 50,
        version: 3,
        state: "ACTIVE",
      }]);
      tx.lot.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.apply("adj-1", validInput),
      ).rejects.toThrow(AdjustmentLotConflictException);
    });

    it("creates a SyncQueue entry on successful apply", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.inventoryAdjustmentDocument.findUnique.mockResolvedValue({
        id: "adj-1",
        state: "DRAFT",
      });
      tx.lot.findMany.mockResolvedValue([{
        id: "lot-1",
        productId: "prod-1",
        currentStock: 50,
        version: 3,
        state: "ACTIVE",
      }]);
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.inventoryAdjustmentDocument.update.mockResolvedValue({
        id: "adj-1",
        state: "APPLIED",
      });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.apply("adj-1", validInput);

      expect(tx.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "INVENTORY_ADJUSTMENT",
            status: "PENDING",
          }),
        }),
      );
    });
  });
});
