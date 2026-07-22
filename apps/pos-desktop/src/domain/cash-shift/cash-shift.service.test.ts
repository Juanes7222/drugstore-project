/**
 * Unit tests for CashShiftService — open, close, and cash counts.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CashShiftService, createCashShiftService } from "./cash-shift.service";
import { ShiftAlreadyOpenException, ShiftNotOpenException, MissingClosingCashCountsException, InvalidCashCountForNonCashMethodException, PaymentMethodNotFoundException } from "./exceptions";
import { BackupFailedException } from "../backup/exceptions";
import { Prisma } from "@pharmacy/database/local";
import { RoleType } from "@pharmacy/shared-types";
import { DomainError } from "../../common/domain-error";

// Mock shift-close-html and print-payload-writer for printRouter tests
vi.mock("./shift-close-html", () => ({
  generateShiftCloseHtml: vi.fn(() => "<html>shift close</html>"),
}));
vi.mock("../printing/print-payload-writer", () => ({
  writePrintPayload: vi.fn(() => "/tmp/shift-close-xxx.html"),
}));

// Mock Tauri's invoke for the backup service created during closeShift.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({
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
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    cashShift: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    shiftCashCount: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
    salePayment: {
      findMany: vi.fn(),
    },
    paymentMethod: {
      findUnique: vi.fn(),
    },
    sale: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    syncQueue: {
      count: vi.fn(),
      aggregate: vi.fn(),
    },
    inventoryAdjustmentDocument: { findFirst: vi.fn() },
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

  describe("openShift", () => {
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
      expect(result.countType).toBe("PARTIAL");
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

      expect(result.countType).toBe("CLOSING");
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
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash" },
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

      expect(result.state).toBe("CLOSED");
      expect(tx.cashShift.update).toHaveBeenCalled();
    });

    it("throws MissingClosingCashCountsException when active methods have no CLOSING count", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());
      tx.cashShift.findUnique.mockResolvedValue({
        id: "shift-1", state: "OPEN",
      });
      tx.shiftCashCount.findMany.mockResolvedValue([]); // no closing counts
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash" },
        { paymentMethodId: "pm-card" },
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
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash" },
      ]);
      tx.syncQueue.count.mockResolvedValue(0);
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });

      // Override the default invoke mock to reject
      const { invoke } = await import("@tauri-apps/api/core");
      vi.mocked(invoke).mockRejectedValueOnce(new BackupFailedException("Backup failed"));

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
      tx.salePayment.findMany.mockResolvedValue([
        { paymentMethodId: "pm-cash" },
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

      expect(result.state).toBe("CLOSED");
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
    it("throws DomainError when adjustmentService is not configured", async () => {
      auth.requireRole.mockReturnValue(makeMockSession());

      await expect(
        service.computeExpectedTotalsByPaymentMethod("shift-1"),
      ).rejects.toThrow(DomainError);
    });

    it("returns aggregated totals per payment method from operational view", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([
        { id: "sale-1" },
        { id: "sale-2" },
      ]);
      tx.invoice.findMany.mockResolvedValue([
        { id: "inv-1", saleId: "sale-1" },
        { id: "inv-2", saleId: "sale-2" },
      ]);

      adjustmentService.resolveOperationalView
        .mockResolvedValueOnce({
          operational: {
            payments: [
              { paymentMethodId: "pm-cash", paymentMethodName: "Efectivo", amount: "50000" },
            ],
          },
        })
        .mockResolvedValueOnce({
          operational: {
            payments: [
              { paymentMethodId: "pm-cash", paymentMethodName: "Efectivo", amount: "30000" },
              { paymentMethodId: "pm-card", paymentMethodName: "Tarjeta", amount: "75000" },
            ],
          },
        });

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.get("pm-cash")!.toString()).toBe("80000");
      expect(result.get("pm-card")!.toString()).toBe("75000");
    });

    it("skips invoices that fail to resolve", async () => {
      const adjustmentService = {
        resolveOperationalView: vi.fn(),
      };
      service = createCashShiftService(prisma, auth as any, adjustmentService as any);

      auth.requireRole.mockReturnValue(makeMockSession());

      tx.sale.findMany.mockResolvedValue([{ id: "sale-1" }]);
      tx.invoice.findMany.mockResolvedValue([{ id: "inv-1", saleId: "sale-1" }]);

      adjustmentService.resolveOperationalView.mockRejectedValueOnce(
        new Error("Invoice not found"),
      );

      const result = await service.computeExpectedTotalsByPaymentMethod("shift-1");

      expect(result.size).toBe(0);
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
        fullData: { payments: [{ paymentMethodName: "Efectivo", amount: "50000" }] },
      }]);

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
        fullData: {
          payments: [{ paymentMethodName: "Efectivo", amount: "50000" }],
        },
      }]);

      adjustmentService.resolveOperationalView.mockResolvedValue({
        fiscal: {
          fullData: {
            payments: [{ paymentMethodName: "Efectivo", amount: "50000" }],
          },
        },
        operational: {
          hasDifferences: true,
          payments: [
            { paymentMethodName: "Tarjeta", paymentMethodName: "Tarjeta", amount: "50000" },
          ],
        },
      });

      const result = await service.getReconciliationDrift("shift-1");

      expect(result).toHaveLength(1);
      expect(result[0].invoiceId).toBe("inv-1");
      expect(result[0].invoiceNumber).toBe("INV-001");
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
      tx.salePayment.findMany.mockResolvedValue([{ paymentMethodId: "pm-cash" }]);
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
});
