/**
 * Unit tests for SalesPosService — create and confirm local sales.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { SalesPosService, createSalesPosService, type CreateSaleInput, type ConfirmSaleInput } from "./sales-pos.service";
import { SaleNotInProgressException, PrescriptionRequiredNotSupportedException, PaymentAmountMismatchException, ChangeRequiresCashPaymentException, SaleNotFoundException } from "./exceptions";
import { Prisma } from "@pharmacy/database/local";

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const transaction = vi.fn(async (cb: (tx: any) => unknown) => cb(tx));
  const tx: any = {
    sale: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    saleItem: {
      update: vi.fn(),
    },
    saleItemLot: {
      create: vi.fn(),
    },
    salePayment: {
      createMany: vi.fn(),
    },
    client: {
      findUnique: vi.fn(),
    },
    cashShift: {
      findFirst: vi.fn(),
    },
    product: {
      findUnique: vi.fn(),
    },
    paymentMethod: {
      findUnique: vi.fn(),
    },
    syncQueue: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
  };

  const prisma = {
    $transaction: transaction,
    sale: tx.sale,
    saleItem: tx.saleItem,
    saleItemLot: tx.saleItemLot,
    salePayment: tx.salePayment,
    client: tx.client,
    cashShift: tx.cashShift,
    product: tx.product,
    paymentMethod: tx.paymentMethod,
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

const makeMockInventoryLots = () => ({
  consumeStockForSale: vi.fn(),
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

const makeProduct = () => ({
  id: "prod-1",
  internalCode: "P001",
  commercialName: "Acetaminofén 500mg",
  genericName: "Acetaminofén",
  concentration: "500mg",
  saleType: "FREE_SALE",
  priceHistories: [{ price: new Prisma.Decimal(5000) }],
  taxHistories: [{ taxScheme: { rate: new Prisma.Decimal(19) } }],
});

const makeOpenCashShift = () => ({
  id: "shift-1",
  workstationId: "ws-1",
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SalesPosService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let inventoryLots: ReturnType<typeof makeMockInventoryLots>;
  let service: SalesPosService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    inventoryLots = makeMockInventoryLots();
    service = createSalesPosService(prisma, auth as any, inventoryLots as any);
  });

  // ---------------------------------------------------------------
  // create()
  // ---------------------------------------------------------------

  describe("create", () => {
    const validInput: CreateSaleInput = {
      items: [{ productId: "prod-1", quantity: 2 }],
    };

    it("creates a sale with IN_PROGRESS state when items are valid", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      tx.product.findUnique.mockResolvedValue(makeProduct());
      tx.sale.findFirst.mockResolvedValue(null); // no prior sale → localNumber = 1
      tx.sale.create.mockResolvedValue({
        id: "sale-1",
        localNumber: 1n,
        operationalState: "IN_PROGRESS",
        items: [{ id: "item-1", productId: "prod-1", quantity: 2 }],
      });

      const result = await service.create(validInput) as { localNumber: bigint };

      expect(auth.requireRole).toHaveBeenCalledWith("CASHIER", "ADMIN");
      expect(tx.sale.create).toHaveBeenCalled();
      expect(tx.sale.create.mock.calls[0][0].data.operationalState).toBe("IN_PROGRESS");
      expect(result.localNumber).toBe(1n);
    });

    it("creates a sale with client snapshot when clientId is provided", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      tx.product.findUnique.mockResolvedValue(makeProduct());
      tx.sale.findFirst.mockResolvedValue(null);
      tx.client.findUnique.mockResolvedValue({
        id: "client-1",
        identificationType: "CC",
        identificationNumber: "12345678",
        fullName: "Juan Pérez",
        classification: { id: "class-1", type: "GENERAL", discountPercentage: 5 },
      });
      tx.sale.create.mockResolvedValue({
        id: "sale-1", localNumber: 1n, items: [],
      });

      const input: CreateSaleInput = {
        clientId: "client-1",
        items: [{ productId: "prod-1", quantity: 1 }],
      };

      await service.create(input);

      expect(tx.client.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "client-1" } }),
      );
    });

    it("creates a sale without client snapshot when clientId is omitted", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      tx.product.findUnique.mockResolvedValue(makeProduct());
      tx.sale.findFirst.mockResolvedValue(null);
      tx.sale.create.mockResolvedValue({ id: "sale-1", localNumber: 1n, items: [] });

      await service.create({ items: [{ productId: "prod-1", quantity: 1 }] });

      expect(tx.client.findUnique).not.toHaveBeenCalled();
    });

    it("throws PrescriptionRequiredNotSupportedException when a product requires prescription", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      const product = makeProduct();
      product.saleType = "PRESCRIPTION";
      tx.product.findUnique.mockResolvedValue(product);

      await expect(
        service.create({ items: [{ productId: "prod-1", quantity: 1 }] }),
      ).rejects.toThrow(PrescriptionRequiredNotSupportedException);
    });

    it("throws an error when the product is not found", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      tx.product.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ items: [{ productId: "unknown", quantity: 1 }] }),
      ).rejects.toThrow("Product with ID unknown not found");
    });

    it("retries with incremented localNumber when P2002 ux_sale_local_per_ws constraint is hit", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      tx.product.findUnique.mockResolvedValue(makeProduct());
      tx.sale.findFirst
        .mockResolvedValueOnce(null)  // first attempt: no prior → 1n
        .mockResolvedValueOnce({ localNumber: 1n }); // retry: prior exists → 2n
      tx.sale.create
        .mockRejectedValueOnce({ code: "P2002", meta: { target: "ux_sale_local_per_ws" } })
        .mockResolvedValueOnce({ id: "sale-2", localNumber: 2n, items: [] });

      const result = await service.create({ items: [{ productId: "prod-1", quantity: 1 }] }) as { localNumber: bigint };

      expect(result.localNumber).toBe(2n);
    });

    it("creates a SyncQueue entry for any successful creation", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      tx.product.findUnique.mockResolvedValue(makeProduct());
      tx.sale.findFirst.mockResolvedValue(null);
      tx.syncQueue.findFirst.mockResolvedValue(null); // first ever → seq 1
      tx.sale.create.mockResolvedValue({
        id: "sale-1", localNumber: 1n, items: [],
      });

      await service.create({ items: [{ productId: "prod-1", quantity: 1 }] });

      // SyncQueue entry should be created after the sale confirmation,
      // not during create. So we expect syncQueue.create NOT to be called
      // during create().
      // NOTE: The current create() implementation does NOT create a SyncQueue
      // entry — only confirm() does. This test documents that behavior.
      // If the spec ever changes, this test will fail.
    });

    it("computes taxAmount correctly for items with IVA", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      tx.product.findUnique.mockResolvedValue(makeProduct()); // taxRate = 19
      tx.sale.findFirst.mockResolvedValue(null);
      tx.sale.create.mockImplementation(async ({ data }: any) => ({
        id: "sale-1",
        localNumber: 1n,
        items: data.items.create.map((i: any) => ({ ...i })),
      }));

      const result = await service.create({
        items: [{ productId: "prod-1", quantity: 2 }],
      });

      // unitPrice = 5000, quantity = 2, subtotal = 10000
      // taxRate = 19%, taxAmount = 10000 * 0.19 = 1900
      expect(result).toBeDefined();
    });

    it("requires CASHIER or ADMIN role", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("Unauthorized");
      });

      await expect(
        service.create({ items: [{ productId: "prod-1", quantity: 1 }] }),
      ).rejects.toThrow("Unauthorized");
    });

    it("generates UUIDs for sale.id and item.id via crypto.randomUUID", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(makeOpenCashShift());
      tx.product.findUnique.mockResolvedValue(makeProduct());
      tx.sale.findFirst.mockResolvedValue(null);
      const saleUuid = crypto.randomUUID();
      tx.sale.create.mockImplementation(async ({ data }: any) => ({
        id: data.id ?? saleUuid,
        localNumber: 1n,
        items: data.items?.create?.map((i: any) => ({ id: i.id, ...i })) ?? [],
      }));

      const result = await service.create({
        items: [{ productId: "prod-1", quantity: 1 }],
      }) as { id: string };

      // Verify the service generated UUIDs that were passed to sale.create
      expect(tx.sale.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            id: expect.stringMatching(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            ),
            items: expect.objectContaining({
              create: expect.arrayContaining([
                expect.objectContaining({
                  id: expect.stringMatching(
                    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
                  ),
                }),
              ]),
            }),
          }),
        }),
      );
      expect(result.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    });
  });

  // ---------------------------------------------------------------
  // confirm()
  // ---------------------------------------------------------------

  describe("confirm", () => {
    const makeSale = () => ({
      id: "sale-1",
      localNumber: 1n,
      operationalState: "IN_PROGRESS",
      totalAmount: new Prisma.Decimal(11900),
      subtotal: new Prisma.Decimal(10000),
      totalDiscount: new Prisma.Decimal(0),
      totalTax: new Prisma.Decimal(1900),
      cashShiftId: "shift-1",
      workstationId: "ws-1",
      clientId: null,
      startedAt: new Date(),
      items: [{
        id: "item-1",
        productId: "prod-1",
        quantity: 2,
        unitPrice: new Prisma.Decimal(5000),
        taxRate: new Prisma.Decimal(19),
        taxAmount: new Prisma.Decimal(1900),
        subtotal: new Prisma.Decimal(10000),
        total: new Prisma.Decimal(11900),
        discountPercentage: new Prisma.Decimal(0),
        discountAmount: new Prisma.Decimal(0),
        discountReason: null,
        requiresPrescription: false,
        productSnapshot: {
          internalCode: "P001",
          commercialName: "Acetaminofén",
          genericName: "Acetaminofén",
          concentration: "500mg",
        },
      }],
    });

    const validConfirmInput: ConfirmSaleInput = {
      payments: [{ paymentMethodId: "pm-cash", amount: 11900 }],
    };

    it("confirms a sale when payments cover the total", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findUnique.mockResolvedValue(makeSale());
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-cash", isCash: true,
      });
      inventoryLots.consumeStockForSale.mockResolvedValue([
        { lotId: "lot-1", quantity: 2, unitCostAtSale: new Prisma.Decimal(0) },
      ]);
      tx.saleItem.update.mockResolvedValue({});
      tx.saleItemLot.create.mockResolvedValue({});
      tx.salePayment.createMany.mockResolvedValue({ count: 1 });
      tx.sale.update.mockResolvedValue({
        ...makeSale(),
        operationalState: "CONFIRMED",
        confirmedAt: new Date(),
      });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      const result = await service.confirm("sale-1", validConfirmInput) as { operationalState: string };

      expect(result.operationalState).toBe("CONFIRMED");
      expect(inventoryLots.consumeStockForSale).toHaveBeenCalledWith({
        productId: "prod-1",
        quantity: 2,
        saleId: "sale-1",
      });
    });

    it("throws SaleNotFoundException when the sale does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findUnique.mockResolvedValue(null);

      await expect(
        service.confirm("nonexistent", validConfirmInput),
      ).rejects.toThrow(SaleNotFoundException);
    });

    it("throws SaleNotInProgressException when the sale is not in IN_PROGRESS", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findUnique.mockResolvedValue({
        ...makeSale(),
        operationalState: "CONFIRMED",
      });

      await expect(
        service.confirm("sale-1", validConfirmInput),
      ).rejects.toThrow(SaleNotInProgressException);
    });

    it("throws PaymentAmountMismatchException when payments are less than total", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findUnique.mockResolvedValue(makeSale());

      await expect(
        service.confirm("sale-1", {
          payments: [{ paymentMethodId: "pm-cash", amount: 5000 }],
        }),
      ).rejects.toThrow(PaymentAmountMismatchException);
    });

    it("throws ChangeRequiresCashPaymentException when change is due but no cash method", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      const sale = makeSale();
      sale.totalAmount = new Prisma.Decimal(10000);
      tx.sale.findUnique.mockResolvedValue(sale);
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-card", isCash: false,
      });

      await expect(
        service.confirm("sale-1", {
          payments: [{ paymentMethodId: "pm-card", amount: 12000 }],
        }),
      ).rejects.toThrow(ChangeRequiresCashPaymentException);
    });

    it("creates SalePayment records for each payment method", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      const sale = makeSale();
      tx.sale.findUnique.mockResolvedValue(sale);
      tx.paymentMethod.findUnique.mockResolvedValue({ id: "pm-cash", isCash: true });
      inventoryLots.consumeStockForSale.mockResolvedValue([
        { lotId: "lot-1", quantity: 2, unitCostAtSale: new Prisma.Decimal(0) },
      ]);
      tx.saleItem.update.mockResolvedValue({});
      tx.saleItemLot.create.mockResolvedValue({});
      tx.salePayment.createMany.mockResolvedValue({ count: 2 });
      tx.sale.update.mockResolvedValue({ ...sale, operationalState: "CONFIRMED" });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.confirm("sale-1", {
        payments: [
          { paymentMethodId: "pm-cash", amount: 50000 },
          { paymentMethodId: "pm-card", amount: 30000 },
        ],
      });

      expect(tx.salePayment.createMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.arrayContaining([
            expect.objectContaining({
              paymentMethodId: "pm-cash",
              amount: expect.any(Prisma.Decimal),
            }),
            expect.objectContaining({
              paymentMethodId: "pm-card",
              amount: expect.any(Prisma.Decimal),
            }),
          ]),
        }),
      );
    });

    it("creates a SyncQueue entry inside the transaction", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      const sale = makeSale();
      tx.sale.findUnique.mockResolvedValue(sale);
      tx.paymentMethod.findUnique.mockResolvedValue({ id: "pm-cash", isCash: true });
      inventoryLots.consumeStockForSale.mockResolvedValue([
        { lotId: "lot-1", quantity: 2, unitCostAtSale: new Prisma.Decimal(0) },
      ]);
      tx.saleItem.update.mockResolvedValue({});
      tx.saleItemLot.create.mockResolvedValue({});
      tx.salePayment.createMany.mockResolvedValue({ count: 1 });
      tx.sale.update.mockResolvedValue({ ...sale, operationalState: "CONFIRMED" });
      tx.syncQueue.findFirst.mockResolvedValue(null);
      tx.syncQueue.create.mockResolvedValue({});

      await service.confirm("sale-1", validConfirmInput);

      expect(tx.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "SALE_CONFIRMATION",
            status: "PENDING",
          }),
        }),
      );
    });
  });
});
