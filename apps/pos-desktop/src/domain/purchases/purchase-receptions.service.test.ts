/**
 * Unit tests for PurchaseReceptionsService — reception lifecycle + stock.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createPurchaseReceptionsService,
  PurchaseReceptionsService,
  type CreateReceptionInput,
} from "./purchase-receptions.service";
import {
  SupplierNotFoundException,
  PurchaseReceptionNotFoundException,
  PurchaseReceptionNotDraftException,
  PurchaseReceptionNotConfirmedException,
  PurchaseOrderNotFoundException,
  PurchaseOrderItemNotFoundException,
  PurchaseOrderItemMismatchException,
  ConcurrentStockModificationException,
} from "./exceptions";
import { RoleType } from "@pharmacy/shared-types";
import {
  PurchaseReceptionState,
  PurchaseOrderState,
  MovementType,
} from "@pharmacy/database/local";

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
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    purchaseReceptionItem: {
      update: vi.fn(),
    },
    purchaseOrder: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    purchaseOrderItem: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    lot: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
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
    ...Object.fromEntries(
      Object.entries(tx).map(([key]) => [key, tx[key]]),
    ),
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

const makePurchaseOrderRecord = (overrides?: Partial<any>) => ({
  id: "po-1",
  sequentialNumber: 1,
  state: PurchaseOrderState.CONFIRMED,
  items: [
    {
      id: "po-item-1",
      productId: "prod-1",
      requestedQuantity: 10,
      receivedQuantity: 0,
      pendingQuantity: 10,
    },
  ],
  ...overrides,
});

const makeLotRecord = (overrides?: Partial<any>) => ({
  id: "lot-1",
  currentStock: 50,
  version: 3,
  ...overrides,
});

const makeReceptionItemRecord = (overrides?: Partial<any>) => ({
  id: "rec-item-1",
  productId: "prod-1",
  purchaseOrderItemId: "po-item-1",
  purchaseOrderItem: {
    id: "po-item-1",
    productId: "prod-1",
    requestedQuantity: 10,
    receivedQuantity: 0,
    pendingQuantity: 10,
  },
  lotId: null,
  receivedQuantity: 10,
  lotNumber: "LOT-001",
  expirationDate: new Date("2027-06-01"),
  realUnitCost: { toString: () => "25000", toNumber: () => 25000 },
  taxSchemeId: "tax-iva",
  taxRate: { toString: () => "19", toNumber: () => 19 },
  discountAmount: { toString: () => "0", toNumber: () => 0 },
  subtotal: { toString: () => "250000", toNumber: () => 250000 },
  total: { toString: () => "297500", toNumber: () => 297500 },
  ...overrides,
});

const makeReceptionRecord = (overrides?: Partial<any>) => ({
  id: "rec-1",
  sequentialNumber: 1,
  state: PurchaseReceptionState.DRAFT,
  supplierId: "supplier-1",
  supplier: { id: "supplier-1", businessName: "Distribuidora Farmacéutica SAS" },
  purchaseOrderId: "po-1",
  purchaseOrder: makePurchaseOrderRecord(),
  notes: null,
  subtotal: { toString: () => "250000", toNumber: () => 250000 },
  totalTax: { toString: () => "47500", toNumber: () => 47500 },
  totalAmount: { toString: () => "297500", toNumber: () => 297500 },
  createdAt: new Date("2026-07-16"),
  createdById: "user-1",
  receivedAt: null,
  items: [makeReceptionItemRecord()],
  ...overrides,
});

const createValidInput = (): CreateReceptionInput => ({
  supplierId: "supplier-1",
  purchaseOrderId: "po-1",
  notes: "Recepción de prueba",
  items: [
    {
      productId: "prod-1",
      receivedQuantity: 10,
      purchaseOrderItemId: "po-item-1",
      lotNumber: "LOT-001",
      expirationDate: "2027-06-01",
      realUnitCost: 25000,
      taxSchemeId: "tax-iva",
      taxRate: 19,
      discountAmount: 0,
    },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PurchaseReceptionsService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: PurchaseReceptionsService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createPurchaseReceptionsService(prisma, auth as any);
  });

  describe("factory", () => {
    it("creates an instance with all expected methods", () => {
      expect(service).toBeInstanceOf(PurchaseReceptionsService);
      expect(service.listReceptions).toBeInstanceOf(Function);
      expect(service.getReception).toBeInstanceOf(Function);
      expect(service.createReception).toBeInstanceOf(Function);
      expect(service.confirmReception).toBeInstanceOf(Function);
      expect(service.annulReception).toBeInstanceOf(Function);
    });
  });

  describe("listReceptions", () => {
    it("returns paginated receptions", async () => {
      tx.purchaseReception.findMany.mockResolvedValue([makeReceptionRecord()]);
      tx.purchaseReception.count.mockResolvedValue(1);

      const result = await service.listReceptions({ page: 1, pageSize: 50 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("filters by supplierId", async () => {
      tx.purchaseReception.findMany.mockResolvedValue([]);
      tx.purchaseReception.count.mockResolvedValue(0);

      await service.listReceptions({ supplierId: "supplier-1" });

      expect(tx.purchaseReception.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: "supplier-1" },
        }),
      );
    });

    it("filters by state", async () => {
      tx.purchaseReception.findMany.mockResolvedValue([]);
      tx.purchaseReception.count.mockResolvedValue(0);

      await service.listReceptions({
        state: PurchaseReceptionState.DRAFT,
      });

      expect(tx.purchaseReception.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { state: PurchaseReceptionState.DRAFT },
        }),
      );
    });
  });

  describe("getReception", () => {
    it("returns reception when found", async () => {
      tx.purchaseReception.findUnique.mockResolvedValue(
        makeReceptionRecord(),
      );

      const result = await service.getReception("rec-1");

      expect(result.id).toBe("rec-1");
    });

    it("throws PurchaseReceptionNotFoundException when reception does not exist", async () => {
      tx.purchaseReception.findUnique.mockResolvedValue(null);

      await expect(service.getReception("nonexistent")).rejects.toThrow(
        PurchaseReceptionNotFoundException,
      );
    });
  });

  describe("createReception", () => {
    it("creates a DRAFT reception successfully", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseOrder.findUnique.mockResolvedValue(makePurchaseOrderRecord());
      tx.purchaseOrderItem.findUnique.mockResolvedValue({
        id: "po-item-1",
        purchaseOrderId: "po-1",
        productId: "prod-1",
      });
      tx.purchaseReception.findFirst.mockResolvedValue(null);
      tx.purchaseReception.create.mockResolvedValue(makeReceptionRecord());

      const result = await service.createReception(createValidInput());

      expect(result.state).toBe(PurchaseReceptionState.DRAFT);
      expect(auth.requireRole).toHaveBeenCalledWith(
        "INVENTORY_ASSISTANT",
        "ADMIN",
      );
    });

    it("throws SupplierNotFoundException when supplier does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(null);

      await expect(service.createReception(createValidInput())).rejects.toThrow(
        SupplierNotFoundException,
      );
    });

    it("throws PurchaseOrderNotFoundException when PO does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseOrder.findUnique.mockResolvedValue(null);

      await expect(service.createReception(createValidInput())).rejects.toThrow(
        PurchaseOrderNotFoundException,
      );
    });

    it("throws PurchaseOrderItemNotFoundException when PO item does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseOrder.findUnique.mockResolvedValue(makePurchaseOrderRecord());
      tx.purchaseOrderItem.findUnique.mockResolvedValue(null);

      await expect(service.createReception(createValidInput())).rejects.toThrow(
        PurchaseOrderItemNotFoundException,
      );
    });

    it("throws PurchaseOrderItemMismatchException when PO item belongs to different PO", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseOrder.findUnique.mockResolvedValue(makePurchaseOrderRecord());
      tx.purchaseOrderItem.findUnique.mockResolvedValue({
        id: "po-item-1",
        purchaseOrderId: "other-po",
        productId: "prod-1",
      });

      await expect(service.createReception(createValidInput())).rejects.toThrow(
        PurchaseOrderItemMismatchException,
      );
    });

    it("throws PurchaseOrderItemMismatchException when product ID does not match", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseOrder.findUnique.mockResolvedValue(makePurchaseOrderRecord());
      tx.purchaseOrderItem.findUnique.mockResolvedValue({
        id: "po-item-1",
        purchaseOrderId: "po-1",
        productId: "other-prod",
      });

      await expect(service.createReception(createValidInput())).rejects.toThrow(
        PurchaseOrderItemMismatchException,
      );
    });

    it("creates reception without purchase order link", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseReception.findFirst.mockResolvedValue(null);
      tx.purchaseReception.create.mockResolvedValue(
        makeReceptionRecord({ purchaseOrderId: null, purchaseOrder: null }),
      );

      const input: CreateReceptionInput = {
        supplierId: "supplier-1",
        items: [
          {
            productId: "prod-1",
            receivedQuantity: 10,
            realUnitCost: 25000,
            taxSchemeId: "tax-iva",
            taxRate: 19,
          },
        ],
      };

      const result = await service.createReception(input);

      expect(result.state).toBe(PurchaseReceptionState.DRAFT);
    });
  });

  describe("confirmReception", () => {
    it("confirms a DRAFT reception, creates lot and SyncQueue entry", async () => {
      const digestSpy = vi
        .spyOn(globalThis.crypto.subtle, "digest")
        .mockResolvedValue(new Uint8Array(32).buffer as ArrayBuffer);
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(
        makeReceptionRecord({ state: PurchaseReceptionState.DRAFT }),
      );
      tx.lot.findFirst.mockResolvedValue(null);
      tx.lot.findFirst.mockResolvedValue(null);
      tx.lot.create.mockResolvedValue(makeLotRecord({ id: "lot-1", currentStock: 0, version: 0 }));
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.purchaseReceptionItem.update.mockResolvedValue({});
      tx.purchaseOrderItem.update.mockResolvedValue({});
      tx.purchaseOrderItem.findMany.mockResolvedValue([
        { pendingQuantity: 0 },
      ]);
      tx.purchaseOrder.update.mockResolvedValue({});
      tx.purchaseReception.update.mockResolvedValue(
        makeReceptionRecord({
          state: PurchaseReceptionState.CONFIRMED,
          receivedAt: new Date(),
        }),
      );
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const result = await service.confirmReception("rec-1");

      expect(result.state).toBe(PurchaseReceptionState.CONFIRMED);
      expect(tx.lot.updateMany).toHaveBeenCalled();
      expect(tx.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: MovementType.PURCHASE_RECEIPT,
          }),
        }),
      );
      expect(tx.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "PURCHASE_RECEPTION_CONFIRMATION",
            status: "PENDING",
          }),
        }),
      );

      digestSpy.mockRestore();
    });

    it("throws PurchaseReceptionNotFoundException when reception does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(null);

      await expect(service.confirmReception("nonexistent")).rejects.toThrow(
        PurchaseReceptionNotFoundException,
      );
    });

    it("throws PurchaseReceptionNotDraftException when reception is not DRAFT", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(
        makeReceptionRecord({ state: PurchaseReceptionState.CONFIRMED }),
      );

      await expect(service.confirmReception("rec-1")).rejects.toThrow(
        PurchaseReceptionNotDraftException,
      );
    });

    it("throws ConcurrentStockModificationException when optimistic lock fails", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(
        makeReceptionRecord({ state: PurchaseReceptionState.DRAFT }),
      );
      tx.lot.findFirst.mockResolvedValue(makeLotRecord({ id: "lot-1" }));
      tx.lot.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.confirmReception("rec-1")).rejects.toThrow(
        ConcurrentStockModificationException,
      );
    });

    it("updates linked purchase order state to FULLY_RECEIVED when all items fulfilled", async () => {
      const digestSpy = vi
        .spyOn(globalThis.crypto.subtle, "digest")
        .mockResolvedValue(new Uint8Array(32).buffer as ArrayBuffer);
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(
        makeReceptionRecord({ state: PurchaseReceptionState.DRAFT }),
      );
      tx.lot.findFirst.mockResolvedValue(null);
      tx.lot.create.mockResolvedValue(makeLotRecord({ id: "lot-1", currentStock: 0, version: 0 }));
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.purchaseReceptionItem.update.mockResolvedValue({});
      tx.purchaseOrderItem.update.mockResolvedValue({});
      tx.purchaseOrderItem.findMany.mockResolvedValue([
        { pendingQuantity: 0 },
      ]);
      tx.purchaseOrder.update.mockResolvedValue({});
      tx.purchaseReception.update.mockResolvedValue(
        makeReceptionRecord({
          state: PurchaseReceptionState.CONFIRMED,
          receivedAt: new Date(),
        }),
      );
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.confirmReception("rec-1");

      expect(tx.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "po-1" },
          data: { state: PurchaseOrderState.FULLY_RECEIVED },
        }),
      );

      digestSpy.mockRestore();
    });

    it("throws AuthException when role is unauthorized", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(service.confirmReception("rec-1")).rejects.toThrow(
        "INSUFFICIENT_ROLE",
      );
    });
  });

  describe("annulReception", () => {
    it("annuls a CONFIRMED reception and reverses stock", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(
        makeReceptionRecord({
          state: PurchaseReceptionState.CONFIRMED,
          items: [
            makeReceptionItemRecord({
              lotId: "lot-1",
              purchaseOrderItemId: "po-item-1",
            }),
          ],
        }),
      );
      tx.lot.findUnique.mockResolvedValue(makeLotRecord({ currentStock: 60, version: 3 }));
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.purchaseOrderItem.update.mockResolvedValue({});
      tx.purchaseOrderItem.findMany.mockResolvedValue([
        { receivedQuantity: 0, pendingQuantity: 10 },
      ]);
      tx.purchaseOrder.update.mockResolvedValue({});
      tx.purchaseReception.update.mockResolvedValue(
        makeReceptionRecord({
          state: PurchaseReceptionState.ANNULLED,
          annulledAt: new Date(),
          annulledById: "user-1",
        }),
      );

      const result = await service.annulReception("rec-1");

      expect(result.state).toBe(PurchaseReceptionState.ANNULLED);
      expect(tx.lot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lot-1", version: 3 },
          data: expect.objectContaining({
            currentStock: 50,
          }),
        }),
      );
      expect(auth.requireRole).toHaveBeenCalledWith("ADMIN");
    });

    it("throws PurchaseReceptionNotFoundException when reception does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(null);

      await expect(service.annulReception("nonexistent")).rejects.toThrow(
        PurchaseReceptionNotFoundException,
      );
    });

    it("throws PurchaseReceptionNotConfirmedException when reception is not CONFIRMED", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(
        makeReceptionRecord({ state: PurchaseReceptionState.DRAFT }),
      );

      await expect(service.annulReception("rec-1")).rejects.toThrow(
        PurchaseReceptionNotConfirmedException,
      );
    });

    it("throws ConcurrentStockModificationException when optimistic lock fails during annul", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(
        makeReceptionRecord({
          state: PurchaseReceptionState.CONFIRMED,
          items: [
            makeReceptionItemRecord({ lotId: "lot-1" }),
          ],
        }),
      );
      tx.lot.findUnique.mockResolvedValue(makeLotRecord({ currentStock: 60, version: 3 }));
      tx.lot.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.annulReception("rec-1")).rejects.toThrow(
        ConcurrentStockModificationException,
      );
    });

    it("reverts linked purchase order state to CONFIRMED when no items received remain", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseReception.findUnique.mockResolvedValue(
        makeReceptionRecord({
          state: PurchaseReceptionState.CONFIRMED,
          purchaseOrder: {
            id: "po-1",
            sequentialNumber: 1,
            state: PurchaseOrderState.PARTIALLY_RECEIVED,
          },
          items: [
            makeReceptionItemRecord({
              lotId: "lot-1",
              purchaseOrderItemId: "po-item-1",
            }),
          ],
        }),
      );
      tx.lot.findUnique.mockResolvedValue(makeLotRecord({ currentStock: 60, version: 3 }));
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.purchaseOrderItem.update.mockResolvedValue({});
      tx.purchaseOrderItem.findMany.mockResolvedValue([
        { receivedQuantity: 0, pendingQuantity: 10 },
      ]);
      tx.purchaseOrder.update.mockResolvedValue({});
      tx.purchaseReception.update.mockResolvedValue(
        makeReceptionRecord({
          state: PurchaseReceptionState.ANNULLED,
          annulledAt: new Date(),
          annulledById: "user-1",
        }),
      );

      await service.annulReception("rec-1");

      expect(tx.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "po-1" },
          data: { state: PurchaseOrderState.CONFIRMED },
        }),
      );
    });

    it("requires ADMIN role", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(service.annulReception("rec-1")).rejects.toThrow(
        "INSUFFICIENT_ROLE",
      );

      expect(auth.requireRole).toHaveBeenCalledWith("ADMIN");
    });
  });
});
