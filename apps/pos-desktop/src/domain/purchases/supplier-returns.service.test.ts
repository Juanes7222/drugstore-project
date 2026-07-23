/**
 * Unit tests for SupplierReturnsService — return lifecycle + stock reversal.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createSupplierReturnsService,
  SupplierReturnsService,
  type CreateSupplierReturnInput,
} from "./supplier-returns.service";
import {
  SupplierNotFoundException,
  SupplierReturnNotFoundException,
  SupplierReturnNotDraftException,
  SupplierReturnCannotBeAnnulledException,
  SupplierReturnLotCostUnavailableException,
  PurchaseReceptionNotFoundException,
  LotNotFoundException,
  ConcurrentStockModificationException,
} from "./exceptions";
import { RoleType } from "@pharmacy/shared-types";
import { PurchaseReturnState, MovementType } from "@pharmacy/database/local";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    supplier: {
      findUnique: vi.fn(),
    },
    purchaseReception: {
      findUnique: vi.fn(),
    },
    purchaseReceptionItem: {
      findFirst: vi.fn(),
    },
    lot: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    supplierReturn: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    inventoryMovement: {
      create: vi.fn(),
    },
    syncQueue: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));
  const transactionArray = vi.fn(async (queries: any[]) =>
    Promise.all(queries.map((q: any) => q)),
  );

  const prisma = {
    $transaction: vi.fn((arg: any) => {
      if (typeof arg === "function") return transaction(arg);
      if (Array.isArray(arg)) return transactionArray(arg);
      return transaction(arg);
    }),
    supplier: tx.supplier,
    purchaseReception: tx.purchaseReception,
    purchaseReceptionItem: tx.purchaseReceptionItem,
    lot: tx.lot,
    supplierReturn: tx.supplierReturn,
    inventoryMovement: tx.inventoryMovement,
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
  disableUser: vi.fn(),
  enableUser: vi.fn(),
  unlockUser: vi.fn(),
  resetUserPin: vi.fn(),
  updateUser: vi.fn(),
  deleteUser: vi.fn(),
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
// Factories
// ---------------------------------------------------------------------------

const makeSupplierRecord = () => ({
  id: "supplier-1",
  businessName: "Distribuidora Farmacéutica SAS",
});

const makeLotRecord = (overrides?: Partial<any>) => ({
  id: "lot-1",
  productId: "prod-1",
  currentStock: 100,
  version: 5,
  state: "ACTIVE",
  ...overrides,
});

const makeReceptionItemRecord = () => ({
  realUnitCost: 25000,
});

const makeReturnItemRecord = (overrides?: Partial<any>) => ({
  id: "ret-item-1",
  productId: "prod-1",
  lotId: "lot-1",
  quantity: 5,
  unitCost: { toString: () => "25000", toNumber: () => 25000 },
  totalAmount: { toString: () => "125000", toNumber: () => 125000 },
  ...overrides,
});

const makeReturnRecord = (overrides?: Partial<any>) => ({
  id: "ret-1",
  sequentialNumber: 1,
  state: PurchaseReturnState.DRAFT,
  supplierId: "supplier-1",
  supplier: { id: "supplier-1", businessName: "Distribuidora Farmacéutica SAS" },
  purchaseReceptionId: "rec-1",
  reason: "Producto dañado",
  notes: null,
  subtotal: { toString: () => "125000", toNumber: () => 125000 },
  totalTax: { toString: () => "0", toNumber: () => 0 },
  totalAmount: { toString: () => "125000", toNumber: () => 125000 },
  createdAt: new Date("2026-07-16"),
  createdById: "user-1",
  items: [makeReturnItemRecord()],
  ...overrides,
});

const createValidInput = (): CreateSupplierReturnInput => ({
  supplierId: "supplier-1",
  purchaseReceptionId: "rec-1",
  reason: "Producto dañado",
  items: [
    { productId: "prod-1", lotId: "lot-1", quantity: 5 },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SupplierReturnsService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: SupplierReturnsService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createSupplierReturnsService(prisma, auth as any);
  });

  describe("factory", () => {
    it("creates an instance with all expected methods", () => {
      expect(service).toBeInstanceOf(SupplierReturnsService);
      expect(service.listReturns).toBeInstanceOf(Function);
      expect(service.getReturn).toBeInstanceOf(Function);
      expect(service.createReturn).toBeInstanceOf(Function);
      expect(service.confirmReturn).toBeInstanceOf(Function);
      expect(service.approveReturn).toBeInstanceOf(Function);
      expect(service.annulReturn).toBeInstanceOf(Function);
    });
  });

  describe("listReturns", () => {
    it("returns paginated supplier returns", async () => {
      tx.supplierReturn.findMany.mockResolvedValue([makeReturnRecord()]);
      tx.supplierReturn.count.mockResolvedValue(1);

      const result = await service.listReturns({ page: 1, pageSize: 50 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("filters by supplierId", async () => {
      tx.supplierReturn.findMany.mockResolvedValue([]);
      tx.supplierReturn.count.mockResolvedValue(0);

      await service.listReturns({ supplierId: "supplier-1" });

      expect(tx.supplierReturn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: "supplier-1" },
        }),
      );
    });

    it("filters by state", async () => {
      tx.supplierReturn.findMany.mockResolvedValue([]);
      tx.supplierReturn.count.mockResolvedValue(0);

      await service.listReturns({ state: PurchaseReturnState.DRAFT });

      expect(tx.supplierReturn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { state: PurchaseReturnState.DRAFT },
        }),
      );
    });
  });

  describe("getReturn", () => {
    it("returns supplier return when found", async () => {
      tx.supplierReturn.findUnique.mockResolvedValue(makeReturnRecord());

      const result = await service.getReturn("ret-1");

      expect(result.id).toBe("ret-1");
    });

    it("throws SupplierReturnNotFoundException when return does not exist", async () => {
      tx.supplierReturn.findUnique.mockResolvedValue(null);

      await expect(service.getReturn("nonexistent")).rejects.toThrow(
        SupplierReturnNotFoundException,
      );
    });
  });

  describe("createReturn", () => {
    it("creates a DRAFT supplier return successfully", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseReception.findUnique.mockResolvedValue({ id: "rec-1" });
      tx.lot.findUnique.mockResolvedValue(makeLotRecord());
      tx.purchaseReceptionItem.findFirst.mockResolvedValue(
        makeReceptionItemRecord(),
      );
      tx.supplierReturn.findFirst.mockResolvedValue(null);
      tx.supplierReturn.create.mockResolvedValue(makeReturnRecord());

      const result = await service.createReturn(createValidInput());

      expect(result.state).toBe(PurchaseReturnState.DRAFT);
      expect(auth.requireRole).toHaveBeenCalledWith(
        "INVENTORY_ASSISTANT",
        "ADMIN",
      );
    });

    it("throws SupplierNotFoundException when supplier does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(null);

      await expect(service.createReturn(createValidInput())).rejects.toThrow(
        SupplierNotFoundException,
      );
    });

    it("throws PurchaseReceptionNotFoundException when referenced reception does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseReception.findUnique.mockResolvedValue(null);

      await expect(service.createReturn(createValidInput())).rejects.toThrow(
        PurchaseReceptionNotFoundException,
      );
    });

    it("throws LotNotFoundException when item references nonexistent lot", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseReception.findUnique.mockResolvedValue({ id: "rec-1" });
      tx.lot.findUnique.mockResolvedValue(null);

      await expect(service.createReturn(createValidInput())).rejects.toThrow(
        LotNotFoundException,
      );
    });

    it("throws SupplierReturnLotCostUnavailableException when no reception item has the lot cost", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseReception.findUnique.mockResolvedValue({ id: "rec-1" });
      tx.lot.findUnique.mockResolvedValue(makeLotRecord());
      tx.purchaseReceptionItem.findFirst.mockResolvedValue(null);

      await expect(service.createReturn(createValidInput())).rejects.toThrow(
        SupplierReturnLotCostUnavailableException,
      );
    });

    it("creates return without purchase reception reference", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.lot.findUnique.mockResolvedValue(makeLotRecord());
      tx.purchaseReceptionItem.findFirst.mockResolvedValue(
        makeReceptionItemRecord(),
      );
      tx.supplierReturn.findFirst.mockResolvedValue(null);
      tx.supplierReturn.create.mockResolvedValue(
        makeReturnRecord({ purchaseReceptionId: null }),
      );

      const input: CreateSupplierReturnInput = {
        supplierId: "supplier-1",
        items: [
          { productId: "prod-1", lotId: "lot-1", quantity: 5 },
        ],
      };

      const result = await service.createReturn(input);

      expect(result.state).toBe(PurchaseReturnState.DRAFT);
    });
  });

  describe("confirmReturn", () => {
    it("confirms a DRAFT return, decrements stock, creates SyncQueue entry", async () => {
      const digestSpy = vi
        .spyOn(globalThis.crypto.subtle, "digest")
        .mockResolvedValue(new Uint8Array(32).buffer as ArrayBuffer);
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.DRAFT }),
      );
      tx.lot.findUnique.mockResolvedValue(makeLotRecord({ currentStock: 100, version: 5 }));
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.supplierReturn.update.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.CONFIRMED }),
      );
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const result = await service.confirmReturn("ret-1");

      expect(result.state).toBe(PurchaseReturnState.CONFIRMED);
      expect(tx.lot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lot-1", version: 5 },
          data: expect.objectContaining({
            currentStock: 95,
          }),
        }),
      );
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: MovementType.SUPPLIER_RETURN,
            quantity: 5,
          }),
        }),
      );
      expect(tx.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "SUPPLIER_RETURN_CONFIRMATION",
            status: "PENDING",
          }),
        }),
      );

      digestSpy.mockRestore();
    });

    it("throws SupplierReturnNotFoundException when return does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(null);

      await expect(service.confirmReturn("nonexistent")).rejects.toThrow(
        SupplierReturnNotFoundException,
      );
    });

    it("throws SupplierReturnNotDraftException when return is not DRAFT", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.CONFIRMED }),
      );

      await expect(service.confirmReturn("ret-1")).rejects.toThrow(
        SupplierReturnNotDraftException,
      );
    });

    it("throws LotNotFoundException when item's lot does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.DRAFT }),
      );
      tx.lot.findUnique.mockResolvedValue(null);

      await expect(service.confirmReturn("ret-1")).rejects.toThrow(
        LotNotFoundException,
      );
    });

    it("throws ConcurrentStockModificationException when optimistic lock fails", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.DRAFT }),
      );
      tx.lot.findUnique.mockResolvedValue(makeLotRecord({ currentStock: 100, version: 5 }));
      tx.lot.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirmReturn("ret-1")).rejects.toThrow(
        ConcurrentStockModificationException,
      );
    });

    it("sets lot state to EXHAUSTED when stock reaches zero", async () => {
      const digestSpy = vi
        .spyOn(globalThis.crypto.subtle, "digest")
        .mockResolvedValue(new Uint8Array(32).buffer as ArrayBuffer);
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.DRAFT }),
      );
      tx.lot.findUnique.mockResolvedValue(makeLotRecord({ currentStock: 5, version: 5 }));
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.supplierReturn.update.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.CONFIRMED }),
      );
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.confirmReturn("ret-1");

      expect(tx.lot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            currentStock: 0,
            state: "EXHAUSTED",
          }),
        }),
      );

      digestSpy.mockRestore();
    });
  });

  describe("approveReturn", () => {
    it("approves a CONFIRMED return", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.CONFIRMED }),
      );
      tx.supplierReturn.update.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.APPROVED }),
      );

      const result = await service.approveReturn("ret-1");

      expect(result.state).toBe(PurchaseReturnState.APPROVED);
      expect(auth.requireRole).toHaveBeenCalledWith("ADMIN");
    });

    it("throws SupplierReturnNotFoundException when return does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(null);

      await expect(service.approveReturn("nonexistent")).rejects.toThrow(
        SupplierReturnNotFoundException,
      );
    });

    it("throws SupplierReturnNotDraftException when return is not CONFIRMED", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.DRAFT }),
      );

      await expect(service.approveReturn("ret-1")).rejects.toThrow(
        SupplierReturnNotDraftException,
      );
    });

    it("requires ADMIN role", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(service.approveReturn("ret-1")).rejects.toThrow(
        "INSUFFICIENT_ROLE",
      );

      expect(auth.requireRole).toHaveBeenCalledWith("ADMIN");
    });
  });

  describe("annulReturn", () => {
    it("annuls a DRAFT return", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.DRAFT }),
      );
      tx.supplierReturn.update.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.ANNULLED }),
      );

      const result = await service.annulReturn("ret-1");

      expect(result.state).toBe(PurchaseReturnState.ANNULLED);
      expect(auth.requireRole).toHaveBeenCalledWith("ADMIN");
    });

    it("throws SupplierReturnNotFoundException when return does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(null);

      await expect(service.annulReturn("nonexistent")).rejects.toThrow(
        SupplierReturnNotFoundException,
      );
    });

    it("throws SupplierReturnCannotBeAnnulledException when return is not DRAFT", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplierReturn.findUnique.mockResolvedValue(
        makeReturnRecord({ state: PurchaseReturnState.CONFIRMED }),
      );

      await expect(service.annulReturn("ret-1")).rejects.toThrow(
        SupplierReturnCannotBeAnnulledException,
      );
    });

    it("requires ADMIN role", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(service.annulReturn("ret-1")).rejects.toThrow(
        "INSUFFICIENT_ROLE",
      );

      expect(auth.requireRole).toHaveBeenCalledWith("ADMIN");
    });
  });
});
