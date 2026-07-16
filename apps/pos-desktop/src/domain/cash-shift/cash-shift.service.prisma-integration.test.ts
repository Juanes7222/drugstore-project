/**
 * PrismaPGlite adapter integration tests for CashShiftService.
 *
 * These tests use the real PrismaClient connected to an in-memory PGlite via
 * the `pglite-prisma-adapter` package.  Unlike the raw-SQL `*.pglite.test.ts`,
 * these tests exercise the actual `CashShiftService` methods through Prisma's
 * query engine, verifying:
 *
 * - Decimal type serialisation/deserialisation through the adapter
 * - Enum mapping (ShiftState, CashCountType) through PrismaClient
 * - The full CashShift lifecycle: open -> register counts -> close
 *
 * ## Test isolation
 *
 * Each test uses a unique workstation suffix so that open shifts from one test
 * do not affect another.  Payment methods are seeded once in `beforeAll`
 * (they are read-only reference data).
 *
 * ## Backup mocking
 *
 * CashShiftService.closeShift calls createBackupService() which depends on
 * Tauri's runtime (window is not defined in Node.js).  We mock the backup
 * module to bypass this dependency for integration testing.
 *
 * @vitest-environment node
 */
import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PrismaPGlite } from "pglite-prisma-adapter";
import { PrismaClient } from "@pharmacy/database/local";
import { LOCAL_SCHEMA_SQL } from "@pharmacy/database/local-schema";
import {
  CashShiftService,
  createCashShiftService,
} from "./cash-shift.service";
import {
  ShiftAlreadyOpenException,
  ShiftNotOpenException,
  InvalidCashCountForNonCashMethodException,
  PaymentMethodNotFoundException,
} from "./exceptions";
import { Prisma } from "@pharmacy/database/local";

// Mock the backup service so closeShift works without Tauri.
vi.mock("../backup", () => ({
  createBackupService: () => ({
    createBackup: vi.fn().mockResolvedValue({ id: "backup-mock" }),
  }),
  BackupFailedException: class BackupFailedException extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "BackupFailedException";
    }
  },
}));

// ---------------------------------------------------------------------------
// Test counter for unique workstation IDs
// ---------------------------------------------------------------------------

let testCounter = 0;

function nextSession() {
  testCounter++;
  return {
    userId: "user-cashier-int-01",
    username: "integration",
    fullName: "Integration Tester",
    displayName: "Integration Tester",
    email: null,
    role: "CASHIER",
    subscriptionId: null,
    workstationId: `ws-int-${String(testCounter).padStart(4, "0")}`,
    accessToken: "token",
    refreshToken: "refresh",
    expiresAt: new Date("2099-12-31"),
    sessionId: `sess-${testCounter}`,
    totpEnabled: false,
    avatarUrl: null,
    avatarColor: null,
    mustChangePassword: false,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("CashShiftService — PrismaClient + PGlite integration", () => {
  let pg: PGlite;
  let prisma: PrismaClient;
  let auth: { requireRole: ReturnType<typeof vi.fn> };
  let cashPmId: string;
  let cardPmId: string;

  beforeAll(async () => {
    pg = new PGlite("memory://");
    await pg.exec(LOCAL_SCHEMA_SQL);

    const adapter = new PrismaPGlite(pg);
    prisma = new PrismaClient({ adapter });

    const now = new Date();
    cashPmId = crypto.randomUUID();
    cardPmId = crypto.randomUUID();

    await prisma.paymentMethod.createMany({
      data: [
        {
          id: cashPmId,
          internalCode: "CASH-INT",
          name: "Efectivo",
          category: "CASH",
          isActive: true,
          isCash: true,
          createdAt: now,
          updatedAt: now,
        },
        {
          id: cardPmId,
          internalCode: "DEBIT-INT",
          name: "Tarjeta Débito",
          category: "DEBIT_CARD",
          isActive: true,
          isCash: false,
          createdAt: now,
          updatedAt: now,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await pg.close();
  });

  beforeEach(() => {
    auth = { requireRole: vi.fn() };
  });

  /** Create a fresh service with a unique workstation session. */
  function makeService(): CashShiftService {
    auth.requireRole.mockReturnValue(nextSession());
    return createCashShiftService(prisma, auth as any);
  }

  // -----------------------------------------------------------------------
  // openShift
  // -----------------------------------------------------------------------
  describe("openShift", () => {
    it("creates an OPEN cash shift with the opening balance", async () => {
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
        openingNotes: "Turno mañana",
      });

      expect(shift.state).toBe("OPEN");
      // Prisma's Decimal strips trailing zeros: "500000.00" -> "500000"
      expect(shift.openingBalance.toString()).toBe("500000");
      expect(Number(shift.openingBalance)).toBe(500000);
      expect(shift.openingNotes).toBe("Turno mañana");
      expect(shift.workstationId).toMatch(/^ws-int-/);
      expect(shift.userId).toBe("user-cashier-int-01");
    });

    it("throws ShiftAlreadyOpenException when a shift is already open for the workstation", async () => {
      // Create two services that share the SAME workstation
      const session1 = nextSession();
      const ws = session1.workstationId;
      auth.requireRole.mockReturnValue(session1);
      const svc1 = createCashShiftService(prisma, auth as any);
      await svc1.openShift({ openingBalance: new Prisma.Decimal("100000.00") });

      // Second attempt with same workstation
      auth.requireRole.mockReturnValue({
        ...session1,
        sessionId: "sess-same-ws",
      });
      const svc2 = createCashShiftService(prisma, auth as any);
      await expect(
        svc2.openShift({ openingBalance: new Prisma.Decimal("200000.00") }),
      ).rejects.toThrow(ShiftAlreadyOpenException);
    });

    it("calls requireRole with CASHIER and ADMIN", async () => {
      const service = makeService();
      await service.openShift({ openingBalance: new Prisma.Decimal("0") });

      expect(auth.requireRole).toHaveBeenCalledWith("CASHIER", "ADMIN");
    });

    it("persists the shift in the database", async () => {
      const service = makeService();
      const session = nextSession();
      auth.requireRole.mockReturnValue(session);
      const localService = createCashShiftService(prisma, auth as any);
      const shift = await localService.openShift({
        openingBalance: new Prisma.Decimal("750000.00"),
      });

      const stored = await prisma.cashShift.findUnique({
        where: { id: shift.id },
      });
      expect(stored).not.toBeNull();
      expect(stored!.state).toBe("OPEN");
      expect(Number(stored!.openingBalance)).toBe(750000);
    });
  });

  // -----------------------------------------------------------------------
  // registerCashCount
  // -----------------------------------------------------------------------
  describe("registerCashCount", () => {
    it("registers a PARTIAL cash count with denominations", async () => {
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });

      const count = await service.registerCashCount(shift.id, {
        countType: "PARTIAL",
        paymentMethodId: cashPmId,
        expectedAmount: new Prisma.Decimal("500000.00"),
        declaredAmount: new Prisma.Decimal("502000.00"),
        denominationsBreakdown: { "50000": 5, "20000": 10, "1000": 50 },
      });

      expect(count.countType).toBe("PARTIAL");
      expect(Number(count.difference)).toBe(2000);
    });

    it("registers a CLOSING cash count", async () => {
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });

      const count = await service.registerCashCount(shift.id, {
        countType: "CLOSING",
        paymentMethodId: cashPmId,
        expectedAmount: new Prisma.Decimal("500000.00"),
        declaredAmount: new Prisma.Decimal("500000.00"),
      });

      expect(count.countType).toBe("CLOSING");
      expect(Number(count.difference)).toBe(0);
    });

    it("throws ShiftNotOpenException when shift is not OPEN", async () => {
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });

      // Close via direct PrismaClient
      await prisma.cashShift.update({
        where: { id: shift.id },
        data: { state: "CLOSED" },
      });

      await expect(
        service.registerCashCount(shift.id, {
          countType: "PARTIAL",
          paymentMethodId: cashPmId,
          expectedAmount: new Prisma.Decimal("0"),
          declaredAmount: new Prisma.Decimal("0"),
        }),
      ).rejects.toThrow(ShiftNotOpenException);
    });

    it("throws PaymentMethodNotFoundException for invalid payment method", async () => {
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });

      await expect(
        service.registerCashCount(shift.id, {
          countType: "PARTIAL",
          paymentMethodId: crypto.randomUUID(),
          expectedAmount: new Prisma.Decimal("0"),
          declaredAmount: new Prisma.Decimal("0"),
        }),
      ).rejects.toThrow(PaymentMethodNotFoundException);
    });

    it("throws InvalidCashCountForNonCashMethodException when denominations for non-cash", async () => {
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });

      await expect(
        service.registerCashCount(shift.id, {
          countType: "PARTIAL",
          paymentMethodId: cardPmId,
          expectedAmount: new Prisma.Decimal("150000.00"),
          declaredAmount: new Prisma.Decimal("150000.00"),
          denominationsBreakdown: { "50000": 3 },
        }),
      ).rejects.toThrow(InvalidCashCountForNonCashMethodException);
    });

    it("persists the cash count in the database", async () => {
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });

      await service.registerCashCount(shift.id, {
        countType: "PARTIAL",
        paymentMethodId: cashPmId,
        expectedAmount: new Prisma.Decimal("500000.00"),
        declaredAmount: new Prisma.Decimal("502000.00"),
      });

      const counts = await prisma.shiftCashCount.findMany({
        where: { cashShiftId: shift.id },
      });
      expect(counts).toHaveLength(1);
      expect(Number(counts[0].declaredAmount)).toBe(502000);
    });
  });

  // -----------------------------------------------------------------------
  // closeShift
  // -----------------------------------------------------------------------
  describe("closeShift", () => {
    it("closes a shift with valid closing counts", async () => {
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });

      // Register CLOSING counts for both payment methods
      await service.registerCashCount(shift.id, {
        countType: "CLOSING",
        paymentMethodId: cashPmId,
        expectedAmount: new Prisma.Decimal("500000.00"),
        declaredAmount: new Prisma.Decimal("502000.00"),
      });
      await service.registerCashCount(shift.id, {
        countType: "CLOSING",
        paymentMethodId: cardPmId,
        expectedAmount: new Prisma.Decimal("150000.00"),
        declaredAmount: new Prisma.Decimal("150000.00"),
      });

      const result = await service.closeShift(shift.id, {
        closingNotes: "Turno cerrado sin novedades",
      });

      expect(result.state).toBe("CLOSED");
      expect(result.closingNotes).toBe("Turno cerrado sin novedades");
      expect(Number(result.expectedClosingAmount)).toBe(650000);
      expect(Number(result.actualClosingAmount)).toBe(652000);
      expect(Number(result.closingDifference)).toBe(2000);
    });

    it("throws ShiftNotOpenException when shift is already closed", async () => {
      const service = makeService();

      // Open a shift, then close it directly
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });
      await prisma.cashShift.update({
        where: { id: shift.id },
        data: { state: "CLOSED" },
      });

      await expect(
        service.closeShift(shift.id, {}),
      ).rejects.toThrow(ShiftNotOpenException);
    });

    it("closes even with zero closing counts when no active payment methods exist", async () => {
      // Since there are no confirmed sales in this shift, getActivePaymentMethods
      // returns empty, so closeShift should succeed with no CLOSING counts.
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });

      const result = await service.closeShift(shift.id, {});
      expect(result.state).toBe("CLOSED");
    });
  });

  // -----------------------------------------------------------------------
  // PrismaClient direct access — Decimal and Enum fidelity
  // -----------------------------------------------------------------------
  describe("PrismaClient — type fidelity", () => {
    it("stores and retrieves Decimal values with correct precision", async () => {
      const session = nextSession();
      auth.requireRole.mockReturnValue(session);
      const service = createCashShiftService(prisma, auth as any);

      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("1234567.89"),
      });

      const stored = await prisma.cashShift.findUnique({
        where: { id: shift.id },
      });

      // Prisma returns Decimal values — toString() shows the raw value
      expect(Number(stored!.openingBalance)).toBe(1234567.89);
    });

    it("stores and retrieves ShiftState enum values correctly", async () => {
      const session = nextSession();
      auth.requireRole.mockReturnValue(session);
      const service = createCashShiftService(prisma, auth as any);

      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("0"),
      });
      expect(shift.state).toBe("OPEN");

      // Force-close via direct PrismaClient
      await prisma.cashShift.update({
        where: { id: shift.id },
        data: { state: "FORCED_CLOSE" },
      });

      const stored = await prisma.cashShift.findUnique({
        where: { id: shift.id },
      });
      expect(stored!.state).toBe("FORCED_CLOSE");
    });

    it("stores and retrieves CashCountType enum values", async () => {
      const session = nextSession();
      auth.requireRole.mockReturnValue(session);
      const service = createCashShiftService(prisma, auth as any);

      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("0"),
      });
      await service.registerCashCount(shift.id, {
        countType: "CLOSING",
        paymentMethodId: cashPmId,
        expectedAmount: new Prisma.Decimal("100.00"),
        declaredAmount: new Prisma.Decimal("100.00"),
      });

      const counts = await prisma.shiftCashCount.findMany({
        where: { cashShiftId: shift.id },
      });
      expect(counts[0].countType).toBe("CLOSING");
    });

    it("stores JSONB denominationsBreakdown correctly", async () => {
      const session = nextSession();
      auth.requireRole.mockReturnValue(session);
      const service = createCashShiftService(prisma, auth as any);

      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("0"),
      });
      await service.registerCashCount(shift.id, {
        countType: "PARTIAL",
        paymentMethodId: cashPmId,
        expectedAmount: new Prisma.Decimal("100.00"),
        declaredAmount: new Prisma.Decimal("150.00"),
        denominationsBreakdown: { "50000": 1, "20000": 2, "10000": 3 },
      });

      const counts = await prisma.shiftCashCount.findMany({
        where: { cashShiftId: shift.id },
      });
      const breakdown = counts[0]
        .denominationsBreakdown as Record<string, number> | null;
      expect(breakdown).not.toBeNull();
      expect(breakdown!["50000"]).toBe(1);
      expect(breakdown!["20000"]).toBe(2);
    });

    it("stores null denominationsBreakdown for non-cash methods", async () => {
      const session = nextSession();
      auth.requireRole.mockReturnValue(session);
      const service = createCashShiftService(prisma, auth as any);

      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("0"),
      });
      await service.registerCashCount(shift.id, {
        countType: "PARTIAL",
        paymentMethodId: cardPmId,
        expectedAmount: new Prisma.Decimal("150000.00"),
        declaredAmount: new Prisma.Decimal("150000.00"),
      });

      const counts = await prisma.shiftCashCount.findMany({
        where: { cashShiftId: shift.id },
      });
      expect(counts[0].denominationsBreakdown).toBeNull();
    });
  });
});
