/**
 * Unit tests for PurchaseOrdersService — PO lifecycle.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createPurchaseOrdersService,
  PurchaseOrdersService,
  type CreatePurchaseOrderInput,
} from "./purchase-orders.service";
import {
  SupplierNotFoundException,
  PurchaseOrderNotFoundException,
  PurchaseOrderNotDraftException,
  PurchaseOrderNotConfirmableException,
} from "./exceptions";
import { RoleType } from "@pharmacy/shared-types";
import { PurchaseOrderState } from "@pharmacy/database/local";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    supplier: {
      findUnique: vi.fn(),
    },
    purchaseOrder: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    purchaseOrderItem: {
      findMany: vi.fn(),
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
    purchaseOrder: tx.purchaseOrder,
    purchaseOrderItem: tx.purchaseOrderItem,
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

const makePurchaseOrderItemRecord = (overrides?: Partial<any>) => ({
  id: "po-item-1",
  productId: "prod-1",
  requestedQuantity: 10,
  receivedQuantity: 0,
  pendingQuantity: 10,
  expectedUnitCost: { toString: () => "25000", toNumber: () => 25000 },
  ...overrides,
});

const makePurchaseOrderRecord = (overrides?: Partial<any>) => ({
  id: "po-1",
  sequentialNumber: 1,
  state: "DRAFT",
  supplierId: "supplier-1",
  supplier: { id: "supplier-1", businessName: "Distribuidora Farmacéutica SAS" },
  expectedDeliveryDate: new Date("2026-08-15"),
  notes: "Pedido urgente",
  subtotal: { toString: () => "250000", toNumber: () => 250000 },
  totalTax: { toString: () => "0", toNumber: () => 0 },
  totalAmount: { toString: () => "250000", toNumber: () => 250000 },
  createdAt: new Date("2026-07-16"),
  createdById: "user-1",
  confirmedAt: null,
  confirmedById: null,
  annulledAt: null,
  items: [makePurchaseOrderItemRecord()],
  ...overrides,
});

const createValidInput = (): CreatePurchaseOrderInput => ({
  supplierId: "supplier-1",
  expectedDeliveryDate: "2026-08-15",
  notes: "Pedido urgente",
  items: [
    { productId: "prod-1", requestedQuantity: 10, expectedUnitCost: 25000 },
    { productId: "prod-2", requestedQuantity: 5, expectedUnitCost: 50000 },
  ],
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PurchaseOrdersService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: PurchaseOrdersService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createPurchaseOrdersService(prisma, auth as any);
  });

  describe("factory", () => {
    it("creates an instance with all expected methods", () => {
      expect(service).toBeInstanceOf(PurchaseOrdersService);
      expect(service.listOrders).toBeInstanceOf(Function);
      expect(service.getOrder).toBeInstanceOf(Function);
      expect(service.createOrder).toBeInstanceOf(Function);
      expect(service.confirmOrder).toBeInstanceOf(Function);
      expect(service.annulOrder).toBeInstanceOf(Function);
    });
  });

  describe("listOrders", () => {
    it("returns paginated purchase orders", async () => {
      tx.purchaseOrder.findMany.mockResolvedValue([makePurchaseOrderRecord()]);
      tx.purchaseOrder.count.mockResolvedValue(1);

      const result = await service.listOrders({ page: 1, pageSize: 50 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });

    it("filters by supplierId when provided", async () => {
      tx.purchaseOrder.findMany.mockResolvedValue([]);
      tx.purchaseOrder.count.mockResolvedValue(0);

      await service.listOrders({ supplierId: "supplier-1" });

      expect(tx.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierId: "supplier-1" },
        }),
      );
    });

    it("filters by state when provided", async () => {
      tx.purchaseOrder.findMany.mockResolvedValue([]);
      tx.purchaseOrder.count.mockResolvedValue(0);

      await service.listOrders({ state: PurchaseOrderState.DRAFT });

      expect(tx.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { state: PurchaseOrderState.DRAFT },
        }),
      );
    });
  });

  describe("getOrder", () => {
    it("returns purchase order when found", async () => {
      tx.purchaseOrder.findUnique.mockResolvedValue(
        makePurchaseOrderRecord(),
      );

      const result = await service.getOrder("po-1");

      expect(result.id).toBe("po-1");
    });

    it("throws PurchaseOrderNotFoundException when order does not exist", async () => {
      tx.purchaseOrder.findUnique.mockResolvedValue(null);

      await expect(service.getOrder("nonexistent")).rejects.toThrow(
        PurchaseOrderNotFoundException,
      );
    });
  });

  describe("createOrder", () => {
    it("creates a DRAFT purchase order successfully", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(makeSupplierRecord());
      tx.purchaseOrder.findFirst.mockResolvedValue(null);
      tx.purchaseOrder.create.mockResolvedValue(makePurchaseOrderRecord());

      const result = await service.createOrder(createValidInput());

      expect(result.state).toBe("DRAFT");
      expect(auth.requireRole).toHaveBeenCalledWith(
        "INVENTORY_ASSISTANT",
        "ADMIN",
      );
    });

    it("throws SupplierNotFoundException when supplier does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.supplier.findUnique.mockResolvedValue(null);

      await expect(service.createOrder(createValidInput())).rejects.toThrow(
        SupplierNotFoundException,
      );
    });

    it("throws AuthException when role is unauthorized", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(service.createOrder(createValidInput())).rejects.toThrow(
        "INSUFFICIENT_ROLE",
      );
    });
  });

  describe("confirmOrder", () => {
    it("confirms a DRAFT purchase order and creates SyncQueue entry", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseOrder.findUnique.mockResolvedValue(
        makePurchaseOrderRecord({ state: PurchaseOrderState.DRAFT }),
      );
      tx.purchaseOrder.update.mockResolvedValue(
        makePurchaseOrderRecord({
          state: PurchaseOrderState.CONFIRMED,
          confirmedAt: new Date(),
          confirmedById: "user-1",
        }),
      );
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});
      // Mock crypto.subtle.digest for computeHash
      const digestSpy = vi
        .spyOn(globalThis.crypto.subtle, "digest")
        .mockResolvedValue(new Uint8Array(32).buffer as ArrayBuffer);

      const result = await service.confirmOrder("po-1");

      expect(result.state).toBe(PurchaseOrderState.CONFIRMED);
      expect(tx.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "PURCHASE_ORDER_CONFIRMATION",
            status: "PENDING",
          }),
        }),
      );
      expect(auth.requireRole).toHaveBeenCalledWith(
        "INVENTORY_ASSISTANT",
        "ADMIN",
      );

      digestSpy.mockRestore();
    });

    it("throws PurchaseOrderNotFoundException when order does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseOrder.findUnique.mockResolvedValue(null);

      await expect(service.confirmOrder("nonexistent")).rejects.toThrow(
        PurchaseOrderNotFoundException,
      );
    });

    it("throws PurchaseOrderNotDraftException when order is not in DRAFT state", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseOrder.findUnique.mockResolvedValue(
        makePurchaseOrderRecord({ state: PurchaseOrderState.CONFIRMED }),
      );

      await expect(service.confirmOrder("po-1")).rejects.toThrow(
        PurchaseOrderNotDraftException,
      );
    });

    it("throws PurchaseOrderNotConfirmableException when order has no items", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseOrder.findUnique.mockResolvedValue(
        makePurchaseOrderRecord({ state: PurchaseOrderState.DRAFT, items: [] }),
      );

      await expect(service.confirmOrder("po-1")).rejects.toThrow(
        PurchaseOrderNotConfirmableException,
      );
    });

    it("throws AuthException when role is unauthorized", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(service.confirmOrder("po-1")).rejects.toThrow(
        "INSUFFICIENT_ROLE",
      );
    });
  });

  describe("annulOrder", () => {
    it("annuls a DRAFT purchase order", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseOrder.findUnique.mockResolvedValue(
        makePurchaseOrderRecord({ state: PurchaseOrderState.DRAFT }),
      );
      tx.purchaseOrder.update.mockResolvedValue(
        makePurchaseOrderRecord({
          state: PurchaseOrderState.ANNULLED,
          annulledAt: new Date(),
          annulledById: "user-1",
        }),
      );

      const result = await service.annulOrder("po-1", "Ya no se necesita");

      expect(result.state).toBe(PurchaseOrderState.ANNULLED);
    });

    it("throws PurchaseOrderNotFoundException when order does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseOrder.findUnique.mockResolvedValue(null);

      await expect(service.annulOrder("nonexistent")).rejects.toThrow(
        PurchaseOrderNotFoundException,
      );
    });

    it("throws PurchaseOrderNotDraftException when order is not DRAFT", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.purchaseOrder.findUnique.mockResolvedValue(
        makePurchaseOrderRecord({ state: PurchaseOrderState.CONFIRMED }),
      );

      await expect(service.annulOrder("po-1")).rejects.toThrow(
        PurchaseOrderNotDraftException,
      );
    });

    it("requires ADMIN role", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("INSUFFICIENT_ROLE");
      });

      await expect(service.annulOrder("po-1")).rejects.toThrow(
        "INSUFFICIENT_ROLE",
      );

      expect(auth.requireRole).toHaveBeenCalledWith("ADMIN");
    });
  });
});
