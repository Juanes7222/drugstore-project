/**
 * Unit tests for CreditService — credit history aggregation and abonos
 * (credit payments).
 *
 * Covers the merge of confirmed credit sales, confirmed credit refunds, and
 * abonos into a single newest-first history list, the debt summary
 * (sales − refunds − payments), the no-credit-method guard, and every
 * validation path of `recordCreditPayment`.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CreditService, createCreditService } from "./credit.service";

vi.mock("../sync/sync-queue-notifier", () => ({
  notifyPendingEntry: vi.fn(),
}));
import { notifyPendingEntry } from "../sync/sync-queue-notifier";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const prisma: any = {
    paymentMethod: { findMany: vi.fn() },
    salePayment: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    clientReturn: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    clientCreditPayment: {
      findMany: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    client: { findUnique: vi.fn() },
    cashShift: { findFirst: vi.fn() },
    syncQueue: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  };
  // Transaction client shares the same model mocks so calls stay observable.
  prisma.$transaction = vi.fn(async (cb: (tx: any) => unknown) => cb(prisma));
  return prisma;
};

const makeMockAuth = () => {
  const mock: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = [
    "requireRole",
    "getCurrentSession",
    "login",
    "logout",
    "completeTwoFactor",
    "refreshSession",
    "requestStepUp",
    "approveStepUp",
    "verifyStepUp",
    "changePassword",
    "changePin",
    "forgotPassword",
    "resetPassword",
    "createUser",
    "listUsers",
    "getPendingStepUpRequests",
    "getAuditLogs",
    "disableUser",
    "enableUser",
    "unlockUser",
    "resetUserPin",
    "updateUser",
  ] as const;
  for (const m of methods) mock[m] = vi.fn();
  return mock;
};

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

const CREDIT_METHOD_ID = "pm-credit";
const CASH_METHOD_ID = "pm-cash";

const makeCreditMethods = () => [
  { id: CREDIT_METHOD_ID, name: "Crédito", category: "CREDIT" },
  { id: CASH_METHOD_ID, name: "Efectivo", category: "CASH" },
];

const makeCreditPayment = (overrides: any = {}) => ({
  id: "sale-payment-1",
  amount: "1200.00", // pesos
  createdAt: new Date("2026-07-20T10:05:00.000Z"),
  paymentMethod: { name: "Crédito" },
  sale: {
    id: "sale-1",
    localNumber: 1042n,
    confirmedAt: new Date("2026-07-20T10:05:00.000Z"),
  },
  ...overrides,
});

const makeCreditReturn = (overrides: any = {}) => ({
  id: "return-1",
  sequentialNumber: 3,
  refundAmount: "250.00",
  createdAt: new Date("2026-07-22T16:00:00.000Z"),
  refundMethodId: CREDIT_METHOD_ID,
  ...overrides,
});

const makeAbono = (overrides: any = {}) => ({
  id: "abono-1",
  sequentialNumber: 1,
  amount: "100.00",
  createdAt: new Date("2026-07-24T09:00:00.000Z"),
  paymentMethodId: CASH_METHOD_ID,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CreditService", () => {
  let prisma: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: CreditService;

  beforeEach(() => {
    prisma = makeMockPrisma();
    auth = makeMockAuth();
    service = createCreditService(prisma, auth as any);
    vi.mocked(notifyPendingEntry).mockClear();

    auth.requireRole.mockReturnValue(makeMockSession());

    // `findMany` is called with different `select` shapes (credit methods,
    // abono methods, debt ids) — mockReturnValue ignores the arg.
    prisma.paymentMethod.findMany.mockReturnValue(makeCreditMethods());
    prisma.salePayment.findMany.mockResolvedValue([]);
    prisma.clientReturn.findMany.mockResolvedValue([]);
    prisma.clientCreditPayment.findMany.mockResolvedValue([]);
    // Debt used by the summary: 1200.00 − 250.00 − 0.00 = 950.00 pesos.
    prisma.salePayment.aggregate.mockResolvedValue({ _sum: { amount: "1200.00" } });
    prisma.clientReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: "250.00" } });
    prisma.clientCreditPayment.aggregate.mockResolvedValue({ _sum: { amount: "0" } });
    prisma.client.findUnique.mockResolvedValue({ id: "client-1", creditLimit: "1000.00" });
  });

  describe("getCreditHistory", () => {
    it("merges credit sales and returns into one newest-first list", async () => {
      prisma.salePayment.findMany.mockResolvedValue([makeCreditPayment()]);
      prisma.clientReturn.findMany.mockResolvedValue([makeCreditReturn()]);

      const result = await service.getCreditHistory("client-1");

      expect(result.creditEnabled).toBe(true);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]).toEqual({
        kind: "RETURN",
        id: "return-1",
        date: "2026-07-22T16:00:00.000Z",
        amountCents: 25000,
        reference: "D-000003",
        methodName: "Crédito",
      });
      expect(result.items[1]).toEqual({
        kind: "SALE",
        id: "sale-1",
        date: "2026-07-20T10:05:00.000Z",
        amountCents: 120000,
        reference: "#1042",
        methodName: "Crédito",
      });
    });

    it("includes abono entries with the AB- reference and payment method name", async () => {
      prisma.clientCreditPayment.findMany.mockResolvedValue([makeAbono()]);

      const result = await service.getCreditHistory("client-1");

      const abonoEntry = result.items.find((e) => e.kind === "PAYMENT");
      expect(abonoEntry).toEqual({
        kind: "PAYMENT",
        id: "abono-1",
        date: "2026-07-24T09:00:00.000Z",
        amountCents: 10000,
        reference: "AB-000001",
        methodName: "Efectivo",
        annulled: false,
        annulmentReason: null,
      });
    });

    it("reports the debt summary in cents, subtracting abonos", async () => {
      prisma.salePayment.findMany.mockResolvedValue([makeCreditPayment()]);
      prisma.clientReturn.findMany.mockResolvedValue([makeCreditReturn()]);
      prisma.clientCreditPayment.aggregate.mockResolvedValue({
        _sum: { amount: "100.00" },
      });

      const result = await service.getCreditHistory("client-1");

      // 120000 − 25000 − 10000 = 85000 cents
      expect(result.debtCents).toBe(85000);
    });

    it("returns an empty, disabled result when no CREDIT method exists", async () => {
      // The service queries `where: { category: 'CREDIT' }`, so an empty
      // result means no credit methods exist locally → the guard short-circuits.
      prisma.paymentMethod.findMany.mockImplementation(async () => []);

      const result = await service.getCreditHistory("client-1");

      expect(result).toEqual({ items: [], debtCents: 0, creditEnabled: false });
      expect(prisma.salePayment.findMany).not.toHaveBeenCalled();
      expect(prisma.clientReturn.findMany).not.toHaveBeenCalled();
    });

    it("requires CASHIER or ADMIN role", async () => {
      auth.requireRole.mockImplementation(() => {
        throw new Error("Unauthorized");
      });

      await expect(service.getCreditHistory("client-1")).rejects.toThrow(
        "Unauthorized",
      );
    });

    it("flags annulled abonos so the UI can badge them", async () => {
      prisma.clientCreditPayment.findMany.mockResolvedValue([
        makeAbono({
          annulledAt: new Date("2026-07-25T11:00:00.000Z"),
          annulmentReason: "Registro duplicado",
        }),
      ]);

      const result = await service.getCreditHistory("client-1");

      const abonoEntry = result.items.find((e) => e.kind === "PAYMENT");
      expect(abonoEntry).toEqual(
        expect.objectContaining({
          id: "abono-1",
          annulled: true,
          annulmentReason: "Registro duplicado",
        }),
      );
    });

    it("excludes annulled abonos from the debt computation", async () => {
      await service.getCreditHistory("client-1");

      expect(prisma.clientCreditPayment.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { clientId: "client-1", annulledAt: null },
        }),
      );
    });
  });

  describe("recordCreditPayment", () => {
    const validInput = {
      clientId: "client-1",
      amountCents: 50000,
      paymentMethodId: CASH_METHOD_ID,
    };

    it("creates the payment and a CLIENT_CREDIT_PAYMENT sync entry in one transaction", async () => {
      prisma.cashShift.findFirst.mockResolvedValue({ id: "shift-1" });
      prisma.clientCreditPayment.findFirst.mockResolvedValue(null);
      prisma.clientCreditPayment.create.mockResolvedValue({ id: "abono-new" });
      prisma.syncQueue.findFirst.mockResolvedValue(null);
      prisma.syncQueue.create.mockResolvedValue({});

      const result = await service.recordCreditPayment(validInput);

      expect(auth.requireRole).toHaveBeenCalledWith("CASHIER", "ADMIN");
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.clientCreditPayment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientId: "client-1",
            amount: expect.any(Object),
            paymentMethodId: CASH_METHOD_ID,
            cashShiftId: "shift-1",
            workstationId: "ws-1",
            createdById: "user-1",
            sequentialNumber: 1,
          }),
        }),
      );
      expect(prisma.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "CLIENT_CREDIT_PAYMENT",
            status: "PENDING",
            payload: expect.stringContaining('"amount":"500.00"'),
          }),
        }),
      );
      expect(result.remainingDebtCents).toBe(45000);
      expect(notifyPendingEntry).toHaveBeenCalledTimes(1);
    });

    it("rejects a non-positive amount", async () => {
      await expect(
        service.recordCreditPayment({ ...validInput, amountCents: 0 }),
      ).rejects.toMatchObject({ errorCode: "CREDIT_PAYMENT_INVALID_AMOUNT" });
    });

    it("rejects an amount above the current debt", async () => {
      // Debt is 95000 cents (1200.00 − 250.00); request 100000.
      await expect(
        service.recordCreditPayment({ ...validInput, amountCents: 100000 }),
      ).rejects.toMatchObject({ errorCode: "CREDIT_PAYMENT_EXCEEDS_DEBT" });
    });

    it("rejects when the client has no credit enabled", async () => {
      prisma.client.findUnique.mockResolvedValue({
        id: "client-1",
        creditLimit: null,
      });

      await expect(service.recordCreditPayment(validInput)).rejects.toMatchObject(
        { errorCode: "CREDIT_NOT_ENABLED_FOR_CLIENT" },
      );
    });

    it("rejects when no cash shift is open anywhere in the store", async () => {
      prisma.cashShift.findFirst.mockResolvedValue(null);

      await expect(service.recordCreditPayment(validInput)).rejects.toMatchObject(
        { errorCode: "NO_OPEN_CASH_SHIFT_FOR_CREDIT_PAYMENT" },
      );
      // The abono lookup is store-wide — no workstationId in the filter.
      expect(prisma.cashShift.findFirst).toHaveBeenCalledWith({
        where: { state: "OPEN" },
        select: { id: true },
      });
    });

    it("attaches the abono to the shift opened at another workstation", async () => {
      // Global shift: an admin opened it at the back office; the cashier
      // recording the abono here works at ws-1.
      prisma.cashShift.findFirst.mockResolvedValue({ id: "shift-other-ws" });
      prisma.clientCreditPayment.findFirst.mockResolvedValue(null);
      prisma.clientCreditPayment.create.mockResolvedValue({ id: "abono-foreign" });
      prisma.syncQueue.findFirst.mockResolvedValue(null);
      prisma.syncQueue.create.mockResolvedValue({});

      await service.recordCreditPayment(validInput);

      const createArg = prisma.clientCreditPayment.create.mock
        .calls[0][0] as { data: { cashShiftId: string; workstationId: string } };
      expect(createArg.data.cashShiftId).toBe("shift-other-ws");
      // The payment row keeps the PAYER's workstation for traceability.
      expect(createArg.data.workstationId).toBe("ws-1");
    });

    it("recomputes the debt inside the transaction and caps the abono", async () => {
      prisma.cashShift.findFirst.mockResolvedValue({ id: "shift-1" });

      // A concurrent sale pushed the debt lower between state load and record.
      prisma.salePayment.aggregate.mockResolvedValue({ _sum: { amount: "400.00" } });
      prisma.clientReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: "0" } });

      await expect(
        service.recordCreditPayment({ ...validInput, amountCents: 50000 }),
      ).rejects.toMatchObject({ errorCode: "CREDIT_PAYMENT_EXCEEDS_DEBT" });
    });
  });

  describe("annulCreditPayment", () => {
    const adminSession = {
      ...makeMockSession(),
      role: "ADMIN",
    };
    const annulPayment = () => ({
      id: "abono-1",
      sequentialNumber: 1,
      clientId: "client-1",
      annulledAt: null,
    });

    beforeEach(() => {
      auth.requireRole.mockReturnValue(adminSession);
      prisma.clientCreditPayment.findUnique.mockResolvedValue(annulPayment());
      prisma.clientCreditPayment.update.mockResolvedValue({});
      prisma.syncQueue.findFirst.mockResolvedValue(null);
      prisma.syncQueue.create.mockResolvedValue({});
      // Debt after the annulment: 1200.00 − 250.00 − 0.00 = 950.00 pesos.
      prisma.salePayment.aggregate.mockResolvedValue({ _sum: { amount: "1200.00" } });
      prisma.clientReturn.aggregate.mockResolvedValue({ _sum: { refundAmount: "250.00" } });
      prisma.clientCreditPayment.aggregate.mockResolvedValue({ _sum: { amount: "0" } });
    });

    it("requires the ADMIN role only", async () => {
      await expect(
        service.annulCreditPayment("abono-1", "Registro errado"),
      ).resolves.toBeDefined();
      expect(auth.requireRole).toHaveBeenCalledWith("ADMIN");
    });

    it("rejects an empty or missing annulment reason", async () => {
      await expect(
        service.annulCreditPayment("abono-1", "   "),
      ).rejects.toMatchObject({
        errorCode: "CREDIT_PAYMENT_ANNULMENT_REASON_REQUIRED",
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects an unknown payment", async () => {
      prisma.clientCreditPayment.findUnique.mockResolvedValue(null);

      await expect(
        service.annulCreditPayment("missing", "Registro errado"),
      ).rejects.toMatchObject({ errorCode: "CREDIT_PAYMENT_NOT_FOUND" });
    });

    it("rejects an already-annulled payment", async () => {
      prisma.clientCreditPayment.findUnique.mockResolvedValue({
        ...annulPayment(),
        annulledAt: new Date("2026-07-25T10:00:00.000Z"),
      });

      await expect(
        service.annulCreditPayment("abono-1", "Registro errado"),
      ).rejects.toMatchObject({
        errorCode: "CREDIT_PAYMENT_CANNOT_BE_ANNULLED",
      });
      expect(prisma.clientCreditPayment.update).not.toHaveBeenCalled();
    });

    it("marks the payment annulled and enqueues a CLIENT_CREDIT_PAYMENT_ANNULMENT sync entry", async () => {
      const result = await service.annulCreditPayment(
        "abono-1",
        "Registro duplicado",
      );

      expect(prisma.clientCreditPayment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "abono-1" },
          data: expect.objectContaining({
            annulledById: "user-1",
            annulmentReason: "Registro duplicado",
          }),
        }),
      );
      expect(prisma.syncQueue.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            operationType: "CLIENT_CREDIT_PAYMENT_ANNULMENT",
            status: "PENDING",
            payload: expect.stringContaining('"annulmentReason":"Registro duplicado"'),
          }),
        }),
      );
      // The reversal restores the debt to its pre-abono level.
      expect(result.remainingDebtCents).toBe(95000);
      expect(result.annulledAt).toBeDefined();
      expect(notifyPendingEntry).toHaveBeenCalledTimes(1);
    });
  });
});
