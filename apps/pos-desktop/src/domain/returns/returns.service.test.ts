/**
 * Unit tests for ReturnsService — create and confirm client returns.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ReturnsService, createReturnsService, type CreateReturnInput } from "./returns.service";
import { SaleForReturnNotFoundException, SaleNotConfirmedForReturnException, ReturnQuantityExceedsSaleException, ReturnSaleItemNotFoundException, ReturnNotInDraftException, ReturnNotFoundException, ReturnStockReversalFailedException } from "./exceptions";
import { RoleType } from "@pharmacy/shared-types";
import { Prisma } from "@pharmacy/database/local";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    sale: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    clientReturn: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    cashShift: {
      findFirst: vi.fn(),
    },
    lot: {
      findUnique: vi.fn(),
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

  const prisma = {
    $transaction: transaction,
    sale: tx.sale,
    clientReturn: tx.clientReturn,
    cashShift: tx.cashShift,
    lot: tx.lot,
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
});

const makeMockSession = () => ({
  userId: "user-1",
  username: "cajero1",
  fullName: "Cajero Uno",
  displayName: "Cajero Uno",
  email: null,
  role: "CASHIER",
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

const makeSale = () => ({
  id: "sale-1",
  localNumber: 1n,
  operationalState: "CONFIRMED",
  workstationId: "ws-1",
  sourceWorkstationId: "ws-1",
  clientId: "client-1",
  clientNameSnapshot: "Juan Pérez",
  totalAmount: new Prisma.Decimal(11900),
  createdAt: new Date(),
  items: [{
    id: "item-1",
    productId: "prod-1",
    quantity: 5,
    unitPrice: new Prisma.Decimal(5000),
    taxRate: new Prisma.Decimal(19),
    taxAmount: new Prisma.Decimal(1900),
    subtotal: new Prisma.Decimal(10000),
    total: new Prisma.Decimal(11900),
    productInternalCodeSnapshot: "P001",
    productCommercialNameSnapshot: "Acetaminofén",
    lots: [{
      id: "sale-item-lot-1",
      lotId: "lot-1",
      quantity: 5,
      unitCostAtSale: new Prisma.Decimal(0),
    }],
    clientReturnItems: [],
  }],
});

const makeOpenCashShift = () => ({
  id: "shift-1",
  workstationId: "ws-1",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ReturnsService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: ReturnsService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createReturnsService(prisma, auth as any);
  });

  describe("create", () => {
    const validCreateInput: CreateReturnInput = {
      saleId: "sale-1",
      clientId: "client-1",
      refundMethodId: "pm-cash",
      reason: "Producto defectuoso",
      items: [{ saleItemId: "item-1", quantity: 2 }],
    };

    it("creates a return in DRAFT state for a confirmed sale", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findUnique.mockResolvedValue(makeSale());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      tx.clientReturn.findFirst.mockResolvedValue(null); // no prior return → sequential = 1
      tx.clientReturn.create.mockResolvedValue({
        id: "return-1",
        state: "DRAFT",
        refundAmount: 4760,
        items: [{ lots: [] }],
      });

      const result = await service.create(validCreateInput);

      expect(auth.requireRole).toHaveBeenCalledWith("CASHIER", "ADMIN");
      expect(result.state).toBe("DRAFT");
      expect(tx.clientReturn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            saleId: "sale-1",
            state: "DRAFT",
          }),
        }),
      );
    });

    it("throws SaleForReturnNotFoundException when the sale does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findUnique.mockResolvedValue(null);

      await expect(
        service.create(validCreateInput),
      ).rejects.toThrow(SaleForReturnNotFoundException);
    });

    it("throws SaleNotConfirmedForReturnException when the sale is not CONFIRMED", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findUnique.mockResolvedValue({
        ...makeSale(),
        operationalState: "IN_PROGRESS",
      });

      await expect(
        service.create(validCreateInput),
      ).rejects.toThrow(SaleNotConfirmedForReturnException);
    });

    it("throws ReturnQuantityExceedsSaleException when quantity exceeds sold amount", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findUnique.mockResolvedValue(makeSale());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());

      await expect(
        service.create({
          ...validCreateInput,
          items: [{ saleItemId: "item-1", quantity: 10 }],
        }),
      ).rejects.toThrow(ReturnQuantityExceedsSaleException);
    });

    it("throws ReturnSaleItemNotFoundException when saleItemId is not in the sale", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findUnique.mockResolvedValue(makeSale());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());

      await expect(
        service.create({
          ...validCreateInput,
          items: [{ saleItemId: "nonexistent-item", quantity: 1 }],
        }),
      ).rejects.toThrow(ReturnSaleItemNotFoundException);
    });
  });

  describe("searchSale", () => {
    it("returns sale data when searching by localNumber", async () => {
      tx.sale.findFirst.mockResolvedValue({
        id: "sale-1",
        localNumber: 1n,
        createdAt: new Date("2026-07-10"),
        clientNameSnapshot: "Juan Pérez",
        workstationId: "ws-1",
        totalAmount: new Prisma.Decimal(11900),
        items: [{
          id: "item-1",
          productId: "prod-1",
          productCommercialNameSnapshot: "Acetaminofén",
          quantity: 5,
          unitPrice: new Prisma.Decimal(5000),
          taxRate: new Prisma.Decimal(19),
          total: new Prisma.Decimal(11900),
          lots: [{ lot: { batchNumber: "B001" } }],
        }],
      });

      const result = await service.searchSale("1");

      expect(result).not.toBeNull();
      expect(result!.localNumber).toBe(1);
      expect(result!.clientName).toBe("Juan Pérez");
      expect(result!.items).toHaveLength(1);
    });

    it("returns null when the sale is not found", async () => {
      tx.sale.findFirst.mockResolvedValue(null);

      const result = await service.searchSale("999");

      expect(result).toBeNull();
    });

    it("returns null when the query is empty", async () => {
      const result = await service.searchSale("");
      expect(result).toBeNull();
    });
  });

  describe("confirm", () => {
    it("confirms a DRAFT return by reversing stock and creating sync queue entry", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.clientReturn.findUnique.mockResolvedValue({
        id: "return-1",
        state: "DRAFT",
        saleId: "sale-1",
        clientId: "client-1",
        refundAmount: new Prisma.Decimal(4760),
        subtotalReturned: new Prisma.Decimal(4000),
        taxReturned: new Prisma.Decimal(760),
        refundMethodId: "pm-cash",
        reason: "Defectuoso",
        notes: null,
        createdById: "user-1",
        cashShiftId: "shift-1",
        workstationId: "ws-1",
        sale: { workstationId: "ws-1" },
        items: [{
          id: "ret-item-1",
          saleItemId: "item-1",
          quantity: 2,
          unitPriceAtSale: new Prisma.Decimal(5000),
          unitPriceAtReturn: new Prisma.Decimal(5000),
          taxAmount: new Prisma.Decimal(760),
          totalAmount: new Prisma.Decimal(4760),
          lots: [{
            id: "ret-item-lot-1",
            lotId: "lot-1",
            quantity: 2,
          }],
        }],
      });
      tx.lot.findUnique.mockResolvedValue({
        id: "lot-1",
        currentStock: 3,
        version: 2,
        state: "ACTIVE",
      });
      tx.lot.updateMany.mockResolvedValue({ count: 1 });
      tx.inventoryMovement.create.mockResolvedValue({});
      tx.clientReturn.update.mockResolvedValue({
        id: "return-1",
        state: "CONFIRMED",
      });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const result = await service.confirm("return-1");

      expect(result).toBeDefined();
      expect(tx.lot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lot-1", version: 2 },
          data: expect.objectContaining({
            currentStock: 5,
            version: 3,
          }),
        }),
      );
      expect(tx.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "CLIENT_RETURN",
            status: "PENDING",
          }),
        }),
      );
    });

    it("throws ReturnNotFoundException when the return does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.clientReturn.findUnique.mockResolvedValue(null);

      await expect(
        service.confirm("nonexistent"),
      ).rejects.toThrow(ReturnNotFoundException);
    });

    it("throws ReturnNotInDraftException when the return is not in DRAFT", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.clientReturn.findUnique.mockResolvedValue({
        id: "return-1",
        state: "CONFIRMED",
        sale: { workstationId: "ws-1" },
      });

      await expect(
        service.confirm("return-1"),
      ).rejects.toThrow(ReturnNotInDraftException);
    });

    it("throws ReturnStockReversalFailedException when lot version conflicts", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.clientReturn.findUnique.mockResolvedValue({
        id: "return-1",
        state: "DRAFT",
        sale: { workstationId: "ws-1" },
        items: [{
          id: "ret-item-1",
          saleItemId: "item-1",
          quantity: 2,
          unitPriceAtSale: new Prisma.Decimal(5000),
          unitPriceAtReturn: new Prisma.Decimal(5000),
          taxAmount: new Prisma.Decimal(760),
          totalAmount: new Prisma.Decimal(4760),
          lots: [{ id: "ll-1", lotId: "lot-1", quantity: 2 }],
        }],
      });
      tx.lot.findUnique.mockResolvedValue({
        id: "lot-1",
        currentStock: 3,
        version: 2,
        state: "ACTIVE",
      });
      tx.lot.updateMany.mockResolvedValue({ count: 0 }); // optimistic lock fails

      await expect(
        service.confirm("return-1"),
      ).rejects.toThrow(ReturnStockReversalFailedException);
    });
  });
});
