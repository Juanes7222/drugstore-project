/**
 * Unit tests for CashShiftService — open, close, and cash counts.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CashShiftService, createCashShiftService } from "./cash-shift.service";
import { dbWriteLock } from "../../infrastructure/write-lock";
import { ShiftAlreadyOpenException, ShiftNotOpenException, MissingClosingCashCountsException, InvalidCashCountForNonCashMethodException, PaymentMethodNotFoundException } from "./exceptions";
import { BackupFailedException } from "../backup/exceptions";
import { Prisma } from "@pharmacy/database/local";
import { RoleType } from "@pharmacy/shared-types";

// Mock shift-close-html and print-payload-writer for printRouter tests
vi.mock("./shift-close-html", () => ({
  generateShiftCloseHtml: vi.fn(() => "<html>shift close</html>"),
}));
vi.mock("../printing/print-payload-writer", () => ({
  writePrintPayload: vi.fn(() => "/tmp/shift-close-xxx.html"),
}));

// Mock the backup service to avoid PGlite WASM loading during tests.
// The real BackupServiceImpl calls getLocalDatabase() which tries to
// fetch PGlite WASM assets from disk — not available in unit test env.
const mockBackupService = {
  createBackup: vi.fn().mockResolvedValue({
    id: "backup-1",
    createdAt: new Date().toISOString(),
    workstationId: "ws-1",
    appVersion: "0.1.0",
    dbSchemaVersion: 1,
    sizeBytes: 1000,
    sha256: "abc123",
    reason: "SHIFT_CLOSE",
    containsUnpushedOperations: false,
    pendingCount: 0,
    failedCount: 0,
    maxClientSequence: 0,
    note: null,
    clockSkewSeconds: null,
    status: "HEALTHY",
  }),
};

vi.mock("../backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../backup")>();
  return {
    ...actual,
    createBackupService: vi.fn(() => mockBackupService),
  };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    cashShift: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    shiftCashCount: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    salePayment: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
    paymentMethod: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    sale: { findMany: vi.fn(), aggregate: vi.fn() },
    invoice: { findMany: vi.fn(), findUnique: vi.fn() },
    syncQueue: {
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    inventoryAdjustmentDocument: { findFirst: vi.fn() },
    invoiceLocalAdjustment: { findMany: vi.fn() },
    $queryRawUnsafe: vi.fn(),
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    $transaction: transaction,
    cashShift: tx.cashShift,
    shiftCashCount: tx.shiftCashCount,
    salePayment: tx.salePayment,
    paymentMethod: tx.paymentMethod,
    sale: tx.sale,
    invoice: tx.invoice,
    invoiceLocalAdjustment: tx.invoiceLocalAdjustment,
    syncQueue: tx.syncQueue,
    $queryRawUnsafe: tx.$queryRawUnsafe,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CashShiftService", () => {
  let prisma: any;
  let tx: any;
  let auth: ReturnType<typeof makeMockAuth>;
  let service: CashShiftService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    auth = makeMockAuth();
    service = createCashShiftService(prisma, auth as any);
  });

  afterEach(() => {
    // Restore any spies placed on the shared dbWriteLock singleton so a
    // failing test can never leak an acquired lock into the next one.
    vi.restoreAllMocks();
  });

  describe("openShift", () => {
    it("holds the PGlite write lock across the open", async () => {
      const acquireSpy = vi.spyOn(dbWriteLock, "acquire");
      const releaseSpy = vi.spyOn(dbWriteLock, "release");

      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(null); // no open shift
      tx.cashShift.create.mockResolvedValue({
        id: "shift-1",
        workstationId: "ws-1",
        userId: "user-1",
        openingBalance: new Prisma.Decimal(500000),
        state: "OPEN",
        openedAt: new Date(),
      });

      await service.openShift({ openingBalance: new Prisma.Decimal(500000) });

      expect(acquireSpy).toHaveBeenCalledTimes(1);
      // User-facing write: foreground priority so it never waits behind
      // queued background sync steps.
      expect(acquireSpy).toHaveBeenCalledWith("foreground");
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(releaseSpy).toHaveBeenCalledAfter(acquireSpy);
    });

    it("creates a shift with OPEN state when no shift is already open", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(null); // no open shift
      tx.cashShift.create.mockResolvedValue({
        id: "shift-1",
        workstationId: "ws-1",
        userId: "user-1",
        openingBalance: new Prisma.Decimal(500000),
        state: "OPEN",
        openedAt: new Date(),
      });

      const result = await service.openShift({
        openingBalance: new Prisma.Decimal(500000),
      });

      expect(auth.requireRole).toHaveBeenCalledWith("CASHIER", "ADMIN");
      expect(tx.cashShift.create).toHaveBeenCalled();
      expect(result.state).toBe("OPEN");
    });

    it("throws ShiftAlreadyOpenException when a shift is already open", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue({
        id: "existing-shift",
        state: "OPEN",
        workstationId: "ws-1",
      });

      await expect(
        service.openShift({ openingBalance: new Prisma.Decimal(100000) }),
      ).rejects.toThrow(ShiftAlreadyOpenException);
    });
  });

  describe("registerCashCount", () => {
    it("creates a PARTIAL cash count for a cash payment method", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-cash", isCash: true, name: "Efectivo",
      });
      tx.shiftCashCount.create.mockResolvedValue({
        id: "count-1",
        countType: "PARTIAL",
      });

      const result = await service.registerCashCount("shift-1", {
        countType: "PARTIAL",
        paymentMethodId: "pm-cash",
        expectedAmount: new Prisma.Decimal(500000),
        declaredAmount: new Prisma.Decimal(510000),
      });

      expect(tx.shiftCashCount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            countType: "PARTIAL",
            paymentMethodId: "pm-cash",
          }),
        }),
      );
      expect((result as any).countType).toBe("PARTIAL");
    });

    it("creates a CLOSING cash count", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-cash", isCash: true, name: "Efectivo",
      });
      tx.shiftCashCount.create.mockResolvedValue({
        id: "count-2",
        countType: "CLOSING",
      });

      const result = await service.registerCashCount("shift-1", {
        countType: "CLOSING",
        paymentMethodId: "pm-cash",
        expectedAmount: new Prisma.Decimal(500000),
        declaredAmount: new Prisma.Decimal(505000),
      });

      expect((result as any).countType).toBe("CLOSING");
    });

    it("throws PaymentMethodNotFoundException when the payment method does not exist", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });
      tx.paymentMethod.findUnique.mockResolvedValue(null);

      await expect(
        service.registerCashCount("shift-1", {
          countType: "PARTIAL",
          paymentMethodId: "nonexistent",
          expectedAmount: new Prisma.Decimal(0),
          declaredAmount: new Prisma.Decimal(0),
        }),
      ).rejects.toThrow(PaymentMethodNotFoundException);
    });

    it("throws InvalidCashCountForNonCashMethodException when denominations are provided for non-cash method", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-card", isCash: false, name: "Tarjeta",
      });

      await expect(
        service.registerCashCount("shift-1", {
          countType: "PARTIAL",
          paymentMethodId: "pm-card",
          expectedAmount: new Prisma.Decimal(200000),
          declaredAmount: new Prisma.Decimal(200000),
          denominationsBreakdown: { "50000": 4 },
        }),
      ).rejects.toThrow(InvalidCashCountForNonCashMethodException);
    });
  });

  describe("closeShift", () => {
    it("closes the shift when CLOSING counts exist for all active methods", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(500000),
          declaredAmount: new Prisma.Decimal(510000),
          difference: new Prisma.Decimal(10000),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash", amount: new Prisma.Decimal(500000) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(500000) } },
      ]);
      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1",
        state: "CLOSED",
        closedAt: new Date(),
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(500000),
        actualClosingAmount: new Prisma.Decimal(510000),
        closingDifference: new Prisma.Decimal(10000),
        closingNotes: null,
      });

      const result = await service.closeShift("shift-1", {});

      expect((result as any).state).toBe("CLOSED");
      expect(tx.cashShift.update).toHaveBeenCalled();
    });

    it("throws MissingClosingCashCountsException when active methods have no CLOSING count", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });
      tx.shiftCashCount.findMany.mockResolvedValue([]); // no closing counts
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash", amount: new Prisma.Decimal(500000) },
        { paymentMethodId: "pm-card", amount: new Prisma.Decimal(300000) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(500000) } },
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(300000) } },
      ]);

      await expect(
        service.closeShift("shift-1", {}),
      ).rejects.toThrow(MissingClosingCashCountsException);
    });

    it("throws ShiftNotOpenException when the shift is already closed", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
      });

      await expect(
        service.closeShift("shift-1", {}),
      ).rejects.toThrow(ShiftNotOpenException);
    });

    it("throws BackupFailedException when the mandatory backup fails", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(500000),
          declaredAmount: new Prisma.Decimal(510000),
          difference: new Prisma.Decimal(10000),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash", amount: new Prisma.Decimal(500000) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(500000) } },
      ]);
      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });

      // Make the backup service fail
      mockBackupService.createBackup.mockRejectedValueOnce(
        new BackupFailedException("Backup failed"),
      );

      await expect(
        service.closeShift("shift-1", {}),
      ).rejects.toThrow(BackupFailedException);
    });
  });

  describe("closeShift with printRouter", () => {
    it("prints the shift close report when printRouter is configured", async () => {
      const printRouter = { print: vi.fn().mockResolvedValue(undefined) };
      service = createCashShiftService(prisma, auth as any, undefined, printRouter as any);

      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(500000),
          declaredAmount: new Prisma.Decimal(510000),
          difference: new Prisma.Decimal(10000),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash", amount: new Prisma.Decimal(500000) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(500000) } },
      ]);
      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1",
        state: "CLOSED",
        closedAt: new Date(),
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(500000),
        actualClosingAmount: new Prisma.Decimal(510000),
        closingDifference: new Prisma.Decimal(10000),
        closingNotes: null,
      });

      const result = await service.closeShift("shift-1", { closingNotes: "Test" });

      expect((result as any).state).toBe("CLOSED");
      expect(printRouter.print).toHaveBeenCalledWith(
        "SHIFT_CLOSE_REPORT",
        expect.objectContaining({
          payloadType: "HTML",
        }),
      );
    });
  });

  describe("registerCashCount (edge cases)", () => {
    it("stores denominationsBreakdown for cash payment methods", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-cash", isCash: true, name: "Efectivo",
      });
      tx.shiftCashCount.create.mockResolvedValue({
        id: "count-1", countType: "CLOSING",
      });

      await service.registerCashCount("shift-1", {
        countType: "CLOSING",
        paymentMethodId: "pm-cash",
        expectedAmount: new Prisma.Decimal(500000),
        declaredAmount: new Prisma.Decimal(510000),
        denominationsBreakdown: { "50000": 10, "20000": 1 },
      });

      expect(tx.shiftCashCount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            denominationsBreakdown: { "50000": 10, "20000": 1 },
          }),
        }),
      );
    });

    it("stores Prisma.DbNull for non-cash methods even without denominations", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-card", isCash: false, name: "Tarjeta",
      });
      tx.shiftCashCount.create.mockResolvedValue({
        id: "count-2", countType: "CLOSING",
      });

      await service.registerCashCount("shift-1", {
        countType: "CLOSING",
        paymentMethodId: "pm-card",
        expectedAmount: new Prisma.Decimal(200000),
        declaredAmount: new Prisma.Decimal(200000),
      });

      expect(tx.shiftCashCount.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            denominationsBreakdown: Prisma.DbNull,
          }),
        }),
      );
    });
  });

  describe("computeExpectedTotalsByPaymentMethod", () => {
    it("returns base totals from SalePayment when adjustmentService is not configured", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash", amount: new Prisma.Decimal(50000) },
        { paymentMethodId: "pm-card", amount: new Prisma.Decimal(75000) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(50000) } },
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(75000) } },
      ]);

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-cash")!.toString()).toBe("50000");
      expect(result.get("pm-card")!.toString()).toBe("75000");
    });

    it("returns empty map when there are no sales in the shift", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.sale.findMany.mockResolvedValue([]);
      tx.salePayment.findMany.mockResolvedValue([]);
      tx.salePayment.groupBy.mockResolvedValue([]);

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.size).toBe(0);
    });

    it("returns base totals when adjustmentService exists but no adjustments found", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash", amount: new Prisma.Decimal(50000) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(50000) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([]);

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-cash")!.toString()).toBe("50000");
    });

    it("applies full PAYMENT_METHOD_CHANGE: original method replaced by new method", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoice.findUnique.mockResolvedValue({ saleId: "sale-1", fullData: null });
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash", amount: "100" } },
      ]);

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-card")!.toString()).toBe("0");
      expect(result.get("pm-cash")!.toString()).toBe("100");
    });

    it("handles partial adjustment (some sales adjusted, some not)", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      // Sale 1: CARD $50 (no adjustment)
      // Sale 2: CARD $50 adjusted to CASH $50
      tx.sale.findMany.mockResolvedValue([
        { id: "sale-1" },
        { id: "sale-2" },
      ]);

      // All payments in the shift (used by getDirectPaymentTotals)
      const allPayments = [
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(50) },
        { saleId: "sale-2", paymentMethodId: "pm-card", amount: new Prisma.Decimal(50) },
      ];
      // Filter by where clause so applyAdjustmentsDirect query for a single
      // saleId doesn't pull in payments from a different sale
      tx.salePayment.findMany.mockImplementation(({ where }: any) => {
        if (where.saleId?.in) {
          return Promise.resolve(allPayments.filter((p) => where.saleId.in.includes(p.saleId)));
        }
        if (where.saleId) {
          return Promise.resolve(allPayments.filter((p) => p.saleId === where.saleId));
        }
        return Promise.resolve(allPayments);
      });
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);

      tx.invoice.findMany.mockResolvedValue([
        { id: "inv-1", saleId: "sale-1" },
        { id: "inv-2", saleId: "sale-2" },
      ]);

      // Filter invoiceLocalAdjustment by invoiceId so each invoice only sees
      // its own adjustments
      const paymentAdjustments = [
        { invoiceId: "inv-2", newValue: { paymentMethodId: "pm-cash", amount: "50" } as Record<string, unknown> },
      ];
      tx.invoiceLocalAdjustment.findMany.mockImplementation(({ where }: any) => {
        if (where.invoiceId?.in) {
          return Promise.resolve(
            paymentAdjustments.filter((a) => where.invoiceId.in.includes(a.invoiceId)),
          );
        }
        return Promise.resolve(
          paymentAdjustments.filter((a) => a.invoiceId === where.invoiceId),
        );
      });

      tx.invoice.findUnique.mockImplementation((args: any) => {
        const saleId = args.where.id === "inv-1" ? "sale-1" : "sale-2";
        return Promise.resolve({ saleId, fullData: null });
      });

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-card")!.toString()).toBe("50");
      expect(result.get("pm-cash")!.toString()).toBe("50");
    });

    it("ignores reversed adjustments (not returned by query due to replacedByAdjustmentId filter)", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      // Query only returns non-reversed adjustments => empty => base totals
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([]);

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-card")!.toString()).toBe("100");
      expect(result.has("pm-cash")).toBe(false);
    });

    it("adds new method to active set even when not in any SalePayment", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoice.findUnique.mockResolvedValue({ saleId: "sale-1", fullData: null });
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash", amount: "100" } },
      ]);

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-card")!.toString()).toBe("0");
      expect(result.get("pm-cash")!.toString()).toBe("100");
    });

    // -----------------------------------------------------------------------
    // resolveOperationalView primary path (new code path)
    // -----------------------------------------------------------------------

    it("adjusts payment methods via resolveOperationalView when primary path succeeds", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      // Batch pre-filter: invoice has a non-reversed payment adjustment.
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([{ invoiceId: "inv-1" }]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodId: "pm-card", amount: "100" }],
          },
        },
        operational: {
          hasDifferences: true,
          payments: [{ paymentMethodId: "pm-cash", amount: "100" }],
        },
      });

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-card")!.toString()).toBe("0");
      expect(result.get("pm-cash")!.toString()).toBe("100");
    });

    it("returns base totals when resolveOperationalView reports no differences", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      // Batch pre-filter: no payment adjustments => nothing to resolve.
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: { fullData: { payments: [] } },
        operational: { hasDifferences: false, payments: [] },
      });

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-card")!.toString()).toBe("100");
      expect(result.size).toBe(1);
    });

    it("falls back to direct adjustment query when resolveOperationalView throws", async () => {
      const adjustmentService = {
        resolveOperationalView: vi
          .fn()
          .mockRejectedValue(new Error("Failed to parse invoice JSON")),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoice.findUnique.mockResolvedValue({ saleId: "sale-1", fullData: null });

      // Fallback queries adjustments directly
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash", amount: "100" } },
      ]);

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-card")!.toString()).toBe("0");
      expect(result.get("pm-cash")!.toString()).toBe("100");
    });
  });

  describe("getReconciliationDrift", () => {
    it("returns empty array when adjustmentService is not configured", async () => {
      const result = await service.getReconciliationDrift("shift-1");

      expect(result).toEqual([]);
    });

    it("returns empty array when shift is not CLOSED", async () => {
      const adjustmentService = { resolveOperationalView: vi.fn() };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });

      const result = await service.getReconciliationDrift("shift-1");

      expect(result).toEqual([]);
    });

    it("returns empty array when no fiscal-operational differences exist", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
      });
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.invoice.findMany.mockResolvedValue([{
        id: "inv-1",
        saleId: "sale-1",
        invoiceNumber: "INV-001",
      }]);
      // The invoice carries a payment adjustment, so it is resolved — but
      // the view reports no differences → no drift.
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1" },
      ]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: { fullData: { payments: {} } },
        operational: {
          hasDifferences: false,
          payments: [],
        },
      });

      const result = await service.getReconciliationDrift("shift-1");

      expect(result).toEqual([]);
    });

    it("returns drift entries when fiscal and operational payment summaries differ", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
      });
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.invoice.findMany.mockResolvedValue([{
        id: "inv-1",
        saleId: "sale-1",
        invoiceNumber: "INV-001",
      }]);
      // Payment-affecting adjustment on inv-1 → it must be resolved.
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1" },
      ]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodName: "Efectivo", amount: "50000" }],
          },
        },
        operational: {
          hasDifferences: true,
          payments: [
            { paymentMethodName: "Tarjeta", amount: "50000" },
          ],
        },
      });

      const result = await service.getReconciliationDrift("shift-1");

      expect(result).toHaveLength(1);
      expect(result[0].invoiceId).toBe("inv-1");
      expect(result[0].invoiceNumber).toBe("INV-001");
    });

    it("skips invoices without payment adjustments (pre-filter)", async () => {
      // Regression: getReconciliationDrift used to resolve the operational
      // view for EVERY invoice of the shift. Invoices without a
      // payment-affecting adjustment cannot drift — their view must not be
      // resolved at all.
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
      });
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }, { id: "sale-2" }]);
      tx.invoice.findMany.mockResolvedValue([
        { id: "inv-1", saleId: "sale-1", invoiceNumber: "INV-001" },
        { id: "inv-2", saleId: "sale-2", invoiceNumber: "INV-002" },
      ]);
      // Only inv-1 has a payment-affecting adjustment.
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1" },
      ]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: { fullData: { payments: [] } },
        operational: { hasDifferences: false, payments: [] },
      });

      const result = await service.getReconciliationDrift("shift-1");

      expect(result).toEqual([]);
      // inv-2 has no payment adjustment → its view is never resolved.
      expect(adjustmentService.resolveOperationalView).toHaveBeenCalledTimes(1);
      expect(adjustmentService.resolveOperationalView).toHaveBeenCalledWith("inv-1");
    });
  });

  describe("getShiftFiscalComparison", () => {
    it("returns fiscal totals mirrored as operational when no adjustment service is configured", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());

      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(50000) } },
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(75000) } },
      ]);
      tx.paymentMethod.findMany.mockResolvedValue([
        { id: "pm-cash", name: "Efectivo", isCash: true },
        { id: "pm-card", name: "Tarjeta", isCash: false },
      ]);
      tx.$queryRawUnsafe.mockResolvedValue([{ count: 0 }]);

      const result = await service.getShiftFiscalComparison("shift-1");

      expect(result.hasDrift).toBe(false);
      expect(result.adjustmentCount).toBe(0);
      expect(result.driftAmount).toBe("0");
      expect(result.totals).toHaveLength(2);
      // Without adjustments, operational mirrors fiscal exactly.
      expect(result.totals.find((t) => t.paymentMethodId === "pm-cash"))
        .toMatchObject({ fiscalAmount: "50000", operationalAmount: "50000" });
    });

    it("reuses the fiscal map as the operational base (single groupBy)", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      // Sale with CARD $100 → adjusted to CASH $100
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1" },
      ]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodId: "pm-card", amount: "100" }],
          },
        },
        operational: {
          hasDifferences: true,
          payments: [{ paymentMethodId: "pm-cash", amount: "100" }],
        },
      });

      // paymentMethod.findMany serves both the category resolver (isActive
      // query) and the name lookup (id-in query).
      tx.paymentMethod.findMany.mockImplementation(() =>
        Promise.resolve([
          { id: "pm-card", name: "Tarjeta", isCash: false, category: "CARD" },
          { id: "pm-cash", name: "Efectivo", isCash: true, category: "CASH" },
        ]),
      );
      tx.$queryRawUnsafe.mockResolvedValue([{ count: 1 }]);

      const result = await service.getShiftFiscalComparison("shift-1");

      expect(result.hasDrift).toBe(true);
      expect(result.adjustmentCount).toBe(1);
      // Sum of positive (operational − fiscal) deltas: the $100 that moved
      // from CARD to CASH. (Sum of absolutes would double-count to $200.)
      expect(result.driftAmount).toBe("100");
      expect(result.totals).toHaveLength(2);

      const card = result.totals.find((t) => t.paymentMethodId === "pm-card");
      expect(card).toMatchObject({
        methodName: "Tarjeta",
        fiscalAmount: "100",
        operationalAmount: "0",
      });

      const cash = result.totals.find((t) => t.paymentMethodId === "pm-cash");
      expect(cash).toMatchObject({
        methodName: "Efectivo",
        isCash: true,
        fiscalAmount: "0",
        operationalAmount: "100",
      });
    });
  });

  // ---------------------------------------------------------------
  // Audit trail
  // ---------------------------------------------------------------

  describe("openShift (audit)", () => {
    it("writes CASH_SHIFT_OPENED event to auditWriter", async () => {
      const auditWriter = { write: vi.fn() };
      service = createCashShiftService(prisma, auth as any, undefined, undefined, auditWriter as any);

      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(null);
      tx.cashShift.create.mockResolvedValue({
        id: "shift-1",
        workstationId: "ws-1",
        userId: "user-1",
        openingBalance: new Prisma.Decimal(500000),
        state: "OPEN",
        openedAt: new Date(),
      });

      await service.openShift({
        openingBalance: new Prisma.Decimal(500000),
      });

      expect(auditWriter.write).toHaveBeenCalledTimes(1);
      expect(auditWriter.write).toHaveBeenCalledWith(
        "CASH_SHIFT_OPENED",
        expect.objectContaining({
          category: "cash_shift",
          entityType: "CashShift",
          entityId: "shift-1",
          userId: "user-1",
          userRole: "CASHIER",
          workstationId: "ws-1",
          details: expect.objectContaining({
            openingBalance: "500000",
          }),
        }),
      );
    });

    it("does not throw when auditWriter is not configured", async () => {
      // service created without auditWriter in beforeEach
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(null);
      tx.cashShift.create.mockResolvedValue({
        id: "shift-1",
        state: "OPEN",
      });

      await expect(
        service.openShift({ openingBalance: new Prisma.Decimal(500000) }),
      ).resolves.toBeDefined();
    });

    it("does not throw when auditWriter.write fails", async () => {
      const auditWriter = { write: vi.fn().mockRejectedValue(new Error("Audit DB down")) };
      service = createCashShiftService(prisma, auth as any, undefined, undefined, auditWriter as any);

      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findFirst.mockResolvedValue(null);
      tx.cashShift.create.mockResolvedValue({
        id: "shift-1",
        state: "OPEN",
      });

      await expect(
        service.openShift({ openingBalance: new Prisma.Decimal(500000) }),
      ).resolves.toBeDefined();
    });
  });

  describe("registerCashCount (audit)", () => {
    it("writes CASH_COUNT_PARTIAL event for PARTIAL counts", async () => {
      const auditWriter = { write: vi.fn() };
      service = createCashShiftService(prisma, auth as any, undefined, undefined, auditWriter as any);

      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({ id: "shift-1", state: "OPEN" });
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-cash", isCash: true, name: "Efectivo",
      });
      tx.shiftCashCount.create.mockResolvedValue({ id: "count-1", countType: "PARTIAL" });

      await service.registerCashCount("shift-1", {
        countType: "PARTIAL",
        paymentMethodId: "pm-cash",
        expectedAmount: new Prisma.Decimal(500000),
        declaredAmount: new Prisma.Decimal(510000),
      });

      expect(auditWriter.write).toHaveBeenCalledTimes(1);
      expect(auditWriter.write).toHaveBeenCalledWith(
        "CASH_COUNT_PARTIAL",
        expect.objectContaining({
          category: "cash_shift",
          entityType: "ShiftCashCount",
          entityId: "count-1",
          details: expect.objectContaining({
            shiftId: "shift-1",
            expectedAmount: "500000",
            declaredAmount: "510000",
          }),
        }),
      );
    });

    it("does not write audit event for CLOSING counts (deferred to closeShift)", async () => {
      const auditWriter = { write: vi.fn() };
      service = createCashShiftService(prisma, auth as any, undefined, undefined, auditWriter as any);

      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({ id: "shift-1", state: "OPEN" });
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-cash", isCash: true, name: "Efectivo",
      });
      tx.shiftCashCount.create.mockResolvedValue({ id: "count-2", countType: "CLOSING" });

      await service.registerCashCount("shift-1", {
        countType: "CLOSING",
        paymentMethodId: "pm-cash",
        expectedAmount: new Prisma.Decimal(500000),
        declaredAmount: new Prisma.Decimal(505000),
      });

      expect(auditWriter.write).not.toHaveBeenCalled();
    });
  });

  describe("closeShift (audit)", () => {
    it("writes CASH_SHIFT_CLOSED event to auditWriter", async () => {
      const auditWriter = { write: vi.fn() };
      service = createCashShiftService(prisma, auth as any, undefined, undefined, auditWriter as any);

      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(500000),
          declaredAmount: new Prisma.Decimal(510000),
          difference: new Prisma.Decimal(10000),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([{ paymentMethodId: "pm-cash", amount: new Prisma.Decimal(500000) }]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(500000) } },
      ]);
      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1",
        state: "CLOSED",
        closedAt: new Date(),
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(500000),
        actualClosingAmount: new Prisma.Decimal(510000),
        closingDifference: new Prisma.Decimal(10000),
        closingNotes: null,
      });

      await service.closeShift("shift-1", {});

      expect(auditWriter.write).toHaveBeenCalledTimes(1);
      expect(auditWriter.write).toHaveBeenCalledWith(
        "CASH_SHIFT_CLOSED",
        expect.objectContaining({
          category: "cash_shift",
          entityType: "CashShift",
          entityId: "shift-1",
          userId: "user-1",
          userRole: "CASHIER",
          workstationId: "ws-1",
          details: expect.objectContaining({
            expectedClosingAmount: "500000",
            actualClosingAmount: "510000",
            closingDifference: "10000",
            paymentMethodCount: 1,
            pendingSyncCount: 0,
            failedSyncCount: 0,
          }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Adjustment-aware getActivePaymentMethods
  // (fix: derive from computeExpectedTotalsByPaymentMethod, not SalePayment)
  // ---------------------------------------------------------------------------

  describe("getActivePaymentMethods with PAYMENT_METHOD_CHANGE adjustments", () => {
    it("returns SalePayment methods when no adjustment service is configured (backward compat)", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      // No adjustmentService — service created in beforeEach

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(500000),
          declaredAmount: new Prisma.Decimal(510000),
          difference: new Prisma.Decimal(10000),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash", amount: new Prisma.Decimal(500000) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(500000) } },
      ]);
      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1",
        state: "CLOSED",
        closedAt: new Date(),
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(500000),
        actualClosingAmount: new Prisma.Decimal(510000),
        closingDifference: new Prisma.Decimal(10000),
        closingNotes: null,
      });

      const result = await service.closeShift("shift-1", {});
      expect((result as any).state).toBe("CLOSED");
    });

    it("excludes fully replaced method and includes the new method from PAYMENT_METHOD_CHANGE", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });

      // Sale confirmed with CARD $100
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoice.findUnique.mockResolvedValue({ saleId: "sale-1", fullData: null });

      // Adjustment query: $100 from CARD → CASH (full replacement)
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash", amount: "100" } },
      ]);

      // Closing count only for CASH (the replacement method)
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(100),
          declaredAmount: new Prisma.Decimal(100),
          difference: new Prisma.Decimal(0),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);
      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1",
        state: "CLOSED",
        closedAt: new Date(),
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(100),
        actualClosingAmount: new Prisma.Decimal(100),
        closingDifference: new Prisma.Decimal(0),
        closingNotes: null,
      });

      // Should succeed with only CASH count — CARD no longer active
      const result = await service.closeShift("shift-1", {});
      expect((result as any).state).toBe("CLOSED");
    });

    it("keeps both methods active when PAYMENT_METHOD_CHANGE is partial", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });

      // Sale 1: CARD $80 (not adjusted)
      // Sale 2: CARD $80 → CASH $30 (adjusted)
      tx.sale.findMany.mockResolvedValue([
        { id: "sale-1" },
        { id: "sale-2" },
      ]);

      const allPayments = [
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(80) },
        { saleId: "sale-2", paymentMethodId: "pm-card", amount: new Prisma.Decimal(80) },
      ];
      tx.salePayment.findMany.mockImplementation(({ where }: any) => {
        if (where.saleId?.in) {
          return Promise.resolve(allPayments.filter((p) => where.saleId.in.includes(p.saleId)));
        }
        if (where.saleId) {
          return Promise.resolve(allPayments.filter((p) => p.saleId === where.saleId));
        }
        return Promise.resolve(allPayments);
      });
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(160) } },
      ]);

      tx.invoice.findMany.mockResolvedValue([
        { id: "inv-1", saleId: "sale-1" },
        { id: "inv-2", saleId: "sale-2" },
      ]);

      tx.invoice.findUnique.mockImplementation((args: any) => {
        const saleId = args.where.id === "inv-1" ? "sale-1" : "sale-2";
        return Promise.resolve({ saleId, fullData: null });
      });

      // Filter by invoiceId so each invoice only sees its own adjustments
      const invoiceAdjustments = [
        { invoiceId: "inv-2", newValue: { paymentMethodId: "pm-cash", amount: "30" } as Record<string, unknown> },
      ];
      tx.invoiceLocalAdjustment.findMany.mockImplementation(({ where }: any) => {
        // Safety net: where.invoiceId.in queries all invoices
        if (where.invoiceId?.in) {
          return Promise.resolve(invoiceAdjustments.filter((a) => where.invoiceId.in.includes(a.invoiceId)));
        }
        if (where.invoiceId) {
          return Promise.resolve(invoiceAdjustments.filter((a) => a.invoiceId === where.invoiceId));
        }
        return Promise.resolve(invoiceAdjustments);
      });

      // Only CASH closing count — CARD still has $80 (from sale-1), should throw
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(30),
          declaredAmount: new Prisma.Decimal(30),
          difference: new Prisma.Decimal(0),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);

      await expect(
        service.closeShift("shift-1", {}),
      ).rejects.toThrow(MissingClosingCashCountsException);
    });
  });

  // ---------------------------------------------------------------------------
  // getActivePaymentMethods safety net — addAdjustmentMethodIds queries
  // InvoiceLocalAdjustment directly to catch methods that totals might exclude.
  // Tests use resolveOperationalView primary path to exercise the full flow.
  // ---------------------------------------------------------------------------

  describe("getActivePaymentMethods safety net", () => {
    it("adds adjustment method IDs via addAdjustmentMethodIds when resolveOperationalView succeeds", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });

      // Sale with CARD $100 → adjusted to CASH $100
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);

      // Primary path: resolveOperationalView returns the adjustment
      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodId: "pm-card", amount: "100" }],
          },
        },
        operational: {
          hasDifferences: true,
          payments: [{ paymentMethodId: "pm-cash", amount: "100" }],
        },
      });

      // Pending-invoice pre-filter (findPaymentAdjustmentInvoiceIds).
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1" },
      ]);
      // Safety net: the addAdjustmentMethodIds JOIN finds the same
      // PAYMENT_METHOD_CHANGE and confirms pm-cash in the active set.
      tx.$queryRawUnsafe.mockResolvedValue([
        { newValue: { paymentMethodId: "pm-cash" } },
      ]);

      // Closing count only for CASH (replacement method)
      tx.shiftCashCount.findMany.mockResolvedValue([{
        paymentMethodId: "pm-cash",
        countType: "CLOSING",
        expectedAmount: new Prisma.Decimal(100),
        declaredAmount: new Prisma.Decimal(100),
        difference: new Prisma.Decimal(0),
        paymentMethodIsCash: true,
        paymentMethod: { name: "Efectivo" },
      }]);

      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
        closedAt: new Date(), openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(100),
        actualClosingAmount: new Prisma.Decimal(100),
        closingDifference: new Prisma.Decimal(0),
        closingNotes: null,
      });

      const result = await service.closeShift("shift-1", {});
      expect((result as any).state).toBe("CLOSED");
      // Safety net code path executed: the joined adjustment query ran
      expect(tx.$queryRawUnsafe).toHaveBeenCalled();
    });

    it("includes methods from adjustment safety net alongside totals-derived methods", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      // Two sales: sale-1 adjusted (CARD→CASH), sale-2 untouched (CARD stays)
      tx.sale.findMany.mockResolvedValue([
        { id: "sale-1" },
        { id: "sale-2" },
      ]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
        { saleId: "sale-2", paymentMethodId: "pm-card", amount: new Prisma.Decimal(200) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(300) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([
        { id: "inv-1", saleId: "sale-1" },
        { id: "inv-2", saleId: "sale-2" },
      ]);

      // inv-1: CARD→CASH change.  inv-2: no differences.
      adjustmentService.resolveOperationalView
        .mockResolvedValueOnce({
          fiscal: { fullData: { payments: [{ paymentMethodId: "pm-card", amount: "100" }] } },
          operational: { hasDifferences: true, payments: [{ paymentMethodId: "pm-cash", amount: "100" }] },
        })
        .mockResolvedValueOnce({
          fiscal: { fullData: { payments: [{ paymentMethodId: "pm-card", amount: "200" }] } },
          operational: { hasDifferences: false, payments: [] },
        });

      // Pending-invoice pre-filter: only inv-1 carries a payment adjustment.
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1" },
      ]);
      // Safety net finds the PAYMENT_METHOD_CHANGE reference
      tx.$queryRawUnsafe.mockResolvedValue([
        { newValue: { paymentMethodId: "pm-cash" } },
      ]);

      // closeShift setup
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });

      // Both CARD (from sale-2) and CASH (from adjustment) are active → both need counts
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-card",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(200),
          declaredAmount: new Prisma.Decimal(200),
          difference: new Prisma.Decimal(0),
          paymentMethodIsCash: false,
          paymentMethod: { name: "Tarjeta" },
        },
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(100),
          declaredAmount: new Prisma.Decimal(100),
          difference: new Prisma.Decimal(0),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);

      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
        closedAt: new Date(), openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(300),
        actualClosingAmount: new Prisma.Decimal(300),
        closingDifference: new Prisma.Decimal(0),
        closingNotes: null,
      });

      const result = await service.closeShift("shift-1", {});
      expect((result as any).state).toBe("CLOSED");
    });
  });

  describe("closeWithCounts with PAYMENT_METHOD_CHANGE", () => {
    it("succeeds when only the new method has a closing count after full replacement", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      // getOpenShift for both closeWithCounts and its internal closeShift call
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });

      // Sales, payments, invoice: CARD $100 fully replaced by CASH
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoice.findUnique.mockResolvedValue({ saleId: "sale-1", fullData: null });

      // Direct adjustment query instead of resolveOperationalView
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash", amount: "100" } },
      ]);

      // paymentMethod.findMany for getActivePaymentMethodsWithNames + findUnique for registerCashCount
      tx.paymentMethod.findMany.mockResolvedValue([
        { id: "pm-cash", name: "Efectivo", isCash: true },
      ]);
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-cash", isCash: true, name: "Efectivo",
      });

      // registerCashCount creates the count
      tx.shiftCashCount.create.mockResolvedValue({
        id: "count-1", countType: "CLOSING",
      });

      // closeShift validation: shiftCashCount.findMany returns the just-created count
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(100),
          declaredAmount: new Prisma.Decimal(100),
          difference: new Prisma.Decimal(0),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);

      // Sync + backup
      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });

      // update
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1",
        state: "CLOSED",
        closedAt: new Date(),
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(100),
        actualClosingAmount: new Prisma.Decimal(100),
        closingDifference: new Prisma.Decimal(0),
        closingNotes: null,
      });

      const result = await service.closeWithCounts("shift-1", {
        counts: [{
          paymentMethodId: "pm-cash",
          declaredAmount: new Prisma.Decimal(100),
        }],
      });

      expect((result as any).state).toBe("CLOSED");
    });

    it("succeeds with resolveOperationalView primary path when only new method has closing count", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);

      // Primary path: resolveOperationalView handles the adjustment
      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodId: "pm-card", amount: "100" }],
          },
        },
        operational: {
          hasDifferences: true,
          payments: [{ paymentMethodId: "pm-cash", amount: "100" }],
        },
      });

      // Safety net data
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash" } },
      ]);

      tx.paymentMethod.findMany.mockResolvedValue([
        { id: "pm-cash", name: "Efectivo", isCash: true },
      ]);
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-cash", isCash: true, name: "Efectivo",
      });

      tx.shiftCashCount.create.mockResolvedValue({
        id: "count-1", countType: "CLOSING",
      });

      tx.shiftCashCount.findMany.mockResolvedValue([{
        paymentMethodId: "pm-cash",
        countType: "CLOSING",
        expectedAmount: new Prisma.Decimal(100),
        declaredAmount: new Prisma.Decimal(100),
        difference: new Prisma.Decimal(0),
        paymentMethodIsCash: true,
        paymentMethod: { name: "Efectivo" },
      }]);

      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });

      tx.cashShift.update.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
        closedAt: new Date(), openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(100),
        actualClosingAmount: new Prisma.Decimal(100),
        closingDifference: new Prisma.Decimal(0),
        closingNotes: null,
      });

      const result = await service.closeWithCounts("shift-1", {
        counts: [{
          paymentMethodId: "pm-cash",
          declaredAmount: new Prisma.Decimal(100),
        }],
      });

      expect((result as any).state).toBe("CLOSED");
    });

    it("resolves each adjusted invoice once across the whole close flow", async () => {
      // Regression: closeWithCounts computed expected totals and then its
      // internal closeShift re-computed active payment methods, running the
      // operational-view resolution twice per adjusted invoice. The totals
      // are now reused, so resolveOperationalView runs exactly once.
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodId: "pm-card", amount: "100" }],
          },
        },
        operational: {
          hasDifferences: true,
          payments: [{ paymentMethodId: "pm-cash", amount: "100" }],
        },
      });

      // Payment-adjustment filter + safety-net query.
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash" } },
      ]);

      tx.paymentMethod.findMany.mockResolvedValue([
        { id: "pm-cash", name: "Efectivo", isCash: true },
      ]);
      tx.paymentMethod.findUnique.mockResolvedValue({
        id: "pm-cash", isCash: true, name: "Efectivo",
      });

      tx.shiftCashCount.create.mockResolvedValue({
        id: "count-1", countType: "CLOSING",
      });
      tx.shiftCashCount.findMany.mockResolvedValue([{
        paymentMethodId: "pm-cash",
        countType: "CLOSING",
        expectedAmount: new Prisma.Decimal(100),
        declaredAmount: new Prisma.Decimal(100),
        difference: new Prisma.Decimal(0),
        paymentMethodIsCash: true,
        paymentMethod: { name: "Efectivo" },
      }]);

      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });

      tx.cashShift.update.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
        closedAt: new Date(), openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(100),
        actualClosingAmount: new Prisma.Decimal(100),
        closingDifference: new Prisma.Decimal(0),
        closingNotes: null,
      });

      const result = await service.closeWithCounts("shift-1", {
        counts: [{
          paymentMethodId: "pm-cash",
          declaredAmount: new Prisma.Decimal(100),
        }],
      });

      expect((result as any).state).toBe("CLOSED");
      // One resolution for the single adjusted invoice — never two.
      expect(adjustmentService.resolveOperationalView).toHaveBeenCalledTimes(1);
      // The whole flow validates the open shift exactly once — the internal
      // count/close variants skip re-reading it per count.
      expect(tx.cashShift.findUnique).toHaveBeenCalledTimes(1);
      // Payment methods are loaded once by closeWithCounts (methodMap) and
      // passed down — registerCashCountInternal must not re-fetch them.
      expect(tx.paymentMethod.findUnique).not.toHaveBeenCalled();
    });

    it("holds the PGlite write lock across the whole close flow", async () => {
      // Regression: a wizard double-click (or a background sync step) must
      // not interleave with the close. The flow acquires dbWriteLock around
      // the entire close, pauses the background first (so sync steps skip
      // instead of queueing behind the backup) and always releases/resumes
      // — even on failure.
      const acquireSpy = vi.spyOn(dbWriteLock, "acquire");
      const releaseSpy = vi.spyOn(dbWriteLock, "release");
      const pauseSpy = vi.spyOn(dbWriteLock, "pauseBackground");
      const resumeSpy = vi.spyOn(dbWriteLock, "resumeBackground");

      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);
      auth.requireRole.mockReturnValue(makeMockSession());

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodId: "pm-card", amount: "100" }],
          },
        },
        operational: {
          hasDifferences: true,
          payments: [{ paymentMethodId: "pm-cash", amount: "100" }],
        },
      });
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash" } },
      ]);
      tx.paymentMethod.findMany.mockResolvedValue([
        { id: "pm-cash", name: "Efectivo", isCash: true },
      ]);
      tx.shiftCashCount.create.mockResolvedValue({ id: "count-1", countType: "CLOSING" });
      tx.shiftCashCount.findMany.mockResolvedValue([{
        paymentMethodId: "pm-cash",
        countType: "CLOSING",
        expectedAmount: new Prisma.Decimal(100),
        declaredAmount: new Prisma.Decimal(100),
        difference: new Prisma.Decimal(0),
        paymentMethodIsCash: true,
        paymentMethod: { name: "Efectivo" },
      }]);
      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
        closedAt: new Date(), openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(100),
        actualClosingAmount: new Prisma.Decimal(100),
        closingDifference: new Prisma.Decimal(0),
        closingNotes: null,
      });

      await service.closeWithCounts("shift-1", {
        counts: [{
          paymentMethodId: "pm-cash",
          declaredAmount: new Prisma.Decimal(100),
        }],
      });

      expect(acquireSpy).toHaveBeenCalledTimes(1);
      // User-facing write: foreground priority so the close never waits
      // behind queued background sync steps.
      expect(acquireSpy).toHaveBeenCalledWith("foreground");
      expect(releaseSpy).toHaveBeenCalledTimes(1);
      expect(releaseSpy).toHaveBeenCalledAfter(acquireSpy);

      // The background is paused for the whole close (its backup dumps the
      // entire DB) and resumed afterwards — sync steps skip instead of
      // queueing behind the critical section.
      expect(pauseSpy).toHaveBeenCalledTimes(1);
      expect(resumeSpy).toHaveBeenCalledTimes(1);
      expect(acquireSpy).toHaveBeenCalledAfter(pauseSpy);
      expect(resumeSpy).toHaveBeenCalledAfter(releaseSpy);
    });
  });

  describe("closeShift validation with PAYMENT_METHOD_CHANGE", () => {
    it("does not throw MissingClosingCashCountsException when original method was fully replaced", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoice.findUnique.mockResolvedValue({ saleId: "sale-1", fullData: null });

      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash", amount: "100" } },
      ]);

      // Only CASH count
      tx.shiftCashCount.findMany.mockResolvedValue([
        {
          paymentMethodId: "pm-cash",
          countType: "CLOSING",
          expectedAmount: new Prisma.Decimal(100),
          declaredAmount: new Prisma.Decimal(100),
          difference: new Prisma.Decimal(0),
          paymentMethodIsCash: true,
          paymentMethod: { name: "Efectivo" },
        },
      ]);

      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1",
        state: "CLOSED",
        closedAt: new Date(),
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(100),
        actualClosingAmount: new Prisma.Decimal(100),
        closingDifference: new Prisma.Decimal(0),
        closingNotes: null,
      });

      await expect(
        service.closeShift("shift-1", {}),
      ).resolves.toBeDefined();
    });

    it("succeeds via resolveOperationalView when original method fully replaced", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN", userId: "user-1",
        openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(0),
        actualClosingAmount: new Prisma.Decimal(0),
        closingDifference: new Prisma.Decimal(0),
      });

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodId: "pm-card", amount: "100" }],
          },
        },
        operational: {
          hasDifferences: true,
          payments: [{ paymentMethodId: "pm-cash", amount: "100" }],
        },
      });

      // Safety net query
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash" } },
      ]);

      tx.shiftCashCount.findMany.mockResolvedValue([{
        paymentMethodId: "pm-cash",
        countType: "CLOSING",
        expectedAmount: new Prisma.Decimal(100),
        declaredAmount: new Prisma.Decimal(100),
        difference: new Prisma.Decimal(0),
        paymentMethodIsCash: true,
        paymentMethod: { name: "Efectivo" },
      }]);

      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });
      tx.cashShift.update.mockResolvedValue({
        id: "shift-1", state: "CLOSED",
        closedAt: new Date(), openedAt: new Date(),
        openingBalance: new Prisma.Decimal(500000),
        expectedClosingAmount: new Prisma.Decimal(100),
        actualClosingAmount: new Prisma.Decimal(100),
        closingDifference: new Prisma.Decimal(0),
        closingNotes: null,
      });

      await expect(
        service.closeShift("shift-1", {}),
      ).resolves.toBeDefined();
    });
  });

  describe("getShiftSalesSummary with PAYMENT_METHOD_CHANGE", () => {
    it("shows the new method with the correct amount, not the original", async () => {
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      // Sale with total $100
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1", totalAmount: new Prisma.Decimal(100) }]);
      tx.sale.aggregate.mockResolvedValue({
        _count: 1,
        _sum: { totalAmount: new Prisma.Decimal(100) },
      });
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-card", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoice.findUnique.mockResolvedValue({ saleId: "sale-1", fullData: null });

      // Adjustment via direct query: $100 from CARD → CASH
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-cash", amount: "100" } },
      ]);

      // getActivePaymentMethodsWithNames queries payment methods
      tx.paymentMethod.findMany.mockResolvedValue([
        { id: "pm-cash", name: "Efectivo", isCash: true },
      ]);

      const result = await service.getShiftSalesSummary("shift-1");

      expect(result.transactionCount).toBe(1);
      expect(result.totalSalesAmount).toBe("100");
      expect(result.totalsByPaymentMethod).toHaveLength(1);
      expect(result.totalsByPaymentMethod[0].paymentMethodId).toBe("pm-cash");
      expect(result.totalsByPaymentMethod[0].methodName).toBe("Efectivo");
      expect(result.totalsByPaymentMethod[0].expectedAmount).toBe("100");
      expect(result.totalsByPaymentMethod[0].isCash).toBe(true);
    });

    it("resolves category enum stored in paymentMethodId back to a real PaymentMethod id", async () => {
      // Regression for a bug where the adjustment-creation modal stores the
      // selected `PaymentMethodCategory` enum value (e.g. "BANK_TRANSFER")
      // in `newValue.paymentMethodId` instead of a real PaymentMethod id.
      // The shift summary should still surface the method correctly.
      const adjustmentService = {};
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      // Sale: CASH $100 in the original SalePayment
      tx.sale.findMany.mockResolvedValue([{ id: "sale-1", totalAmount: new Prisma.Decimal(100) }]);
      tx.sale.aggregate.mockResolvedValue({
        _count: 1,
        _sum: { totalAmount: new Prisma.Decimal(100) },
      });
      tx.salePayment.findMany.mockResolvedValue([
        { saleId: "sale-1", paymentMethodId: "pm-cash", amount: new Prisma.Decimal(100) },
      ]);
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-cash", _sum: { amount: new Prisma.Decimal(100) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);
      tx.invoice.findUnique.mockResolvedValue({ saleId: "sale-1", fullData: null });

      // Adjustment: stores the category enum "BANK_TRANSFER" in
      // paymentMethodId (the modal quirk).
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        {
          invoiceId: "inv-1",
          newValue: { paymentMethodId: "BANK_TRANSFER", paymentMethodName: "Transferencia", amount: "100" },
        },
      ]);

      // The resolver needs the active payment methods to map "BANK_TRANSFER"
      // to the real UUID. The getActivePaymentMethodsWithNames call also
      // needs this list to render the method name.
      tx.paymentMethod.findMany.mockImplementation(({ where }: any) => {
        if (where?.isActive) {
          return Promise.resolve([
            { id: "pm-cash", category: "CASH" },
            { id: "pm-transfer", category: "BANK_TRANSFER" },
          ]);
        }
        return Promise.resolve([
          { id: "pm-transfer", name: "Transferencia", isCash: false },
        ]);
      });

      const result = await service.getShiftSalesSummary("shift-1");

      expect(result.transactionCount).toBe(1);
      expect(result.totalSalesAmount).toBe("100");
      expect(result.totalsByPaymentMethod).toHaveLength(1);
      // The summary should now show the real PaymentMethod.id, not "BANK_TRANSFER".
      expect(result.totalsByPaymentMethod[0].paymentMethodId).toBe("pm-transfer");
      expect(result.totalsByPaymentMethod[0].methodName).toBe("Transferencia");
      expect(result.totalsByPaymentMethod[0].expectedAmount).toBe("100");
      expect(result.totalsByPaymentMethod[0].isCash).toBe(false);
    });

    it("resolves each adjusted invoice exactly once (no double computation)", async () => {
      // Regression: getShiftSalesSummary used to compute expected totals
      // twice — once inside getActivePaymentMethods and once directly — so
      // every adjusted invoice's operational view was resolved twice. The
      // summary must now resolve each pending invoice a single time.
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }, { id: "sale-2" }]);
      tx.sale.aggregate.mockResolvedValue({
        _count: 2,
        _sum: { totalAmount: new Prisma.Decimal(200) },
      });
      tx.salePayment.groupBy.mockResolvedValue([
        { paymentMethodId: "pm-card", _sum: { amount: new Prisma.Decimal(200) } },
      ]);
      tx.invoice.findMany.mockResolvedValue([
        { id: "inv-1", saleId: "sale-1" },
        { id: "inv-2", saleId: "sale-2" },
      ]);
      // Both invoices carry a non-reversed payment adjustment → both pending.
      tx.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { invoiceId: "inv-1", newValue: { paymentMethodId: "pm-card" } },
        { invoiceId: "inv-2", newValue: { paymentMethodId: "pm-card" } },
      ]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodId: "pm-card", amount: "100" }],
          },
        },
        operational: {
          hasDifferences: false,
          payments: [{ paymentMethodId: "pm-card", amount: "100" }],
        },
      });

      // Used by both the payment-method resolver (isActive) and the
      // active-methods names lookup (id IN ...).
      tx.paymentMethod.findMany.mockResolvedValue([
        { id: "pm-card", name: "Tarjeta", isCash: false, category: "DEBIT_CARD" },
      ]);

      const result = await service.getShiftSalesSummary("shift-1");

      expect(result.transactionCount).toBe(2);
      expect(result.totalsByPaymentMethod[0].expectedAmount).toBe("200");
      // One resolution per pending invoice — never two.
      expect(adjustmentService.resolveOperationalView).toHaveBeenCalledTimes(2);
    });
  });

  describe("getShiftHistory", () => {
    it("returns workstation shifts for a MANAGER session without a permission exception", async () => {
      // A session whose only allowed role is MANAGER proves the guard
      // accepts the manager role instead of throwing.
      auth.requireRole.mockImplementation((...roles: string[]) => {
        if (!roles.includes(RoleType.MANAGER)) {
          throw new Error("insufficient role");
        }
        return makeMockSession();
      });
      const shift = { id: "shift-1", workstationId: "ws-1", state: "CLOSED" };
      tx.cashShift.findMany.mockResolvedValue([shift]);
      tx.cashShift.count.mockResolvedValue(1);

      const result = await service.getShiftHistory({ limit: 50, offset: 0 });

      expect(result.shifts).toEqual([shift]);
      expect(result.total).toBe(1);
      // Legacy offset path keeps the prev/next UI working.
      expect(tx.cashShift.findMany).toHaveBeenCalledWith({
        where: { workstationId: "ws-1" },
        orderBy: [{ openedAt: "desc" }, { id: "desc" }],
        take: 50,
        skip: 0,
      });
    });

    it("uses keyset cursor pagination when a cursor is provided", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      const shift = { id: "shift-2", workstationId: "ws-1", state: "CLOSED" };
      tx.cashShift.findMany.mockResolvedValue([shift]);
      tx.cashShift.count.mockResolvedValue(100);

      const result = await service.getShiftHistory({
        limit: 20,
        cursor: { id: "shift-1" },
      });

      expect(result.shifts).toEqual([shift]);
      // Keyset: skip the cursor row itself and anchor on its id instead of
      // scanning-and-discarding an OFFSET.
      expect(tx.cashShift.findMany).toHaveBeenCalledWith({
        where: { workstationId: "ws-1" },
        orderBy: [{ openedAt: "desc" }, { id: "desc" }],
        take: 20,
        skip: 1,
        cursor: { id: "shift-1" },
      });
    });
  });
});
