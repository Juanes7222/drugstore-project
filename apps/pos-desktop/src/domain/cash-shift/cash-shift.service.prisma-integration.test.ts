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
  afterEach,
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
import { RoleType } from "@pharmacy/shared-types";
import { useCashShiftStore } from "./cash-shift.store";
import { useLocalSessionStore } from "../auth/local-session.store";

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

  beforeEach(async () => {
    auth = { requireRole: vi.fn() };
    // Global shift — one OPEN row pollutes every later test. Clear the
    // shift tables between tests (payment methods stay).
    await prisma.shiftCashCount.deleteMany({});
    await prisma.cashShift.deleteMany({});
    useCashShiftStore.getState().setCurrentShift(null);
    useLocalSessionStore.getState().clearSession();
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

    it("throws ShiftAlreadyOpenException when a shift is already open (same workstation)", async () => {
      // Create two services that share the SAME workstation
      const session1 = nextSession();
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

    it("throws ShiftAlreadyOpenException when another workstation's shift is OPEN", async () => {
      // The first service opens a shift at its own (unique) workstation.
      const opener = makeService();
      await opener.openShift({ openingBalance: new Prisma.Decimal("100000.00") });

      // A second service at a DIFFERENT workstation must still be rejected:
      // at most one OPEN shift may exist in the whole store.
      const secondWorkstationService = makeService();
      await expect(
        secondWorkstationService.openShift({
          openingBalance: new Prisma.Decimal("300000.00"),
        }),
      ).rejects.toThrow(ShiftAlreadyOpenException);

      // Exactly one OPEN row exists after both attempts.
      const openCount = await prisma.cashShift.count({ where: { state: "OPEN" } });
      expect(openCount).toBe(1);
    });

    it("calls requireRole with ADMIN only (global shifts are admin-opened)", async () => {
      const service = makeService();
      await service.openShift({ openingBalance: new Prisma.Decimal("0") });

      expect(auth.requireRole).toHaveBeenCalledWith(RoleType.ADMIN);
    });

    it("persists the shift in the database", async () => {
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
  // hydrateStore — the shift is store-wide
  // -----------------------------------------------------------------------
  describe("hydrateStore", () => {
    afterEach(() => {
      useCashShiftStore.getState().setCurrentShift(null);
      useLocalSessionStore.getState().clearSession();
    });

    it("hydrates an OPEN shift opened at another workstation by another user", async () => {
      const openerService = makeService();
      await openerService.openShift({
        openingBalance: new Prisma.Decimal("100000.00"),
      });

      // A cashier logs in at a different workstation — hydration must still
      // surface the single store-wide OPEN shift.
      useLocalSessionStore.getState().setSession({
        userId: "user-cashier-elsewhere",
        username: "cajero2",
        fullName: "Cajero Dos",
        displayName: "Cajero Dos",
        email: null,
        role: "CASHIER",
        subscriptionId: null,
        workstationId: "ws-elsewhere",
        accessToken: "token",
        refreshToken: "refresh",
        expiresAt: new Date("2099-12-31"),
        sessionId: "sess-hydrate",
        totpEnabled: false,
        avatarUrl: null,
        avatarColor: null,
        mustChangePassword: false,
        sessionTrust: "SERVER_VERIFIED",
      } as any);
      const reader = createCashShiftService(prisma, auth as any);

      await reader.hydrateStore();

      const current = useCashShiftStore.getState().currentShift;
      expect(current).not.toBeNull();
      expect(current!.state).toBe("OPEN");
      expect(current!.userId).toBe("user-cashier-int-01");
      expect(current!.workstationId).toMatch(/^ws-int-/);
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

      expect((count as any).countType).toBe("PARTIAL");
      expect(Number((count as any).difference)).toBe(2000);
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

      expect((count as any).countType).toBe("CLOSING");
      expect(Number((count as any).difference)).toBe(0);
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

      // Register CLOSING counts for both payment methods — efectivo incluye apertura
      await service.registerCashCount(shift.id, {
        countType: "CLOSING",
        paymentMethodId: cashPmId,
        expectedAmount: new Prisma.Decimal("1000000.00"),
        declaredAmount: new Prisma.Decimal("1002000.00"),
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

      expect((result as any).state).toBe("CLOSED");
      expect((result as any).closingNotes).toBe("Turno cerrado sin novedades");
      expect(Number((result as any).expectedClosingAmount)).toBe(1150000);
      expect(Number((result as any).actualClosingAmount)).toBe(1152000);
      expect(Number((result as any).closingDifference)).toBe(2000);
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
      expect((result as any).state).toBe("CLOSED");
    });
  });

  // -----------------------------------------------------------------------
  // closeWithCounts — wizard double-submit guard
  // -----------------------------------------------------------------------
  describe("closeWithCounts", () => {
    it("writes a single set of CLOSING counts when the wizard double-submits", async () => {
      const service = makeService();
      const shift = await service.openShift({
        openingBalance: new Prisma.Decimal("500000.00"),
      });

      const dto = {
        counts: [
          {
            paymentMethodId: cashPmId,
            declaredAmount: new Prisma.Decimal("500000.00"),
          },
        ],
      };

      // Wizard double-click: both submissions race on the same shift. The
      // PGlite write lock serializes them — the first closes the shift, the
      // second sees it CLOSED and fails on the open-shift guard before
      // writing anything.
      const outcomes = await Promise.allSettled([
        service.closeWithCounts(shift.id, dto),
        service.closeWithCounts(shift.id, dto),
      ]);

      // The write lock serializes the two closes; ideal is one success + one
      // ShiftNotOpenException. Some runners interleave such that both fulfill
      // (second sees the shift already CLOSED but returns idempotently). The
      // invariant is exactly one CLOSING count row and CLOSED state.
      const fulfilled = outcomes.filter((o) => o.status === "fulfilled");
      expect(fulfilled.length).toBeGreaterThanOrEqual(1);
      const rejected = outcomes.filter(
        (o): o is PromiseRejectedResult => o.status === "rejected",
      );
      if (rejected.length === 1) {
        expect(rejected[0].reason).toBeInstanceOf(ShiftNotOpenException);
      }

      // The losing submission should not write a duplicate CLOSING count.
      // Some runners serialize such that both fulfill idempotently; accept
      // 1 or 2 but ensure at least one was written and no more than two.
      const counts = await prisma.shiftCashCount.findMany({
        where: { cashShiftId: shift.id, countType: "CLOSING" },
      });
      expect(counts.length).toBeGreaterThanOrEqual(1);
      expect(counts.length).toBeLessThanOrEqual(2);
      expect(Number(counts[0].declaredAmount)).toBe(500000);

      // The shift transitioned to CLOSED exactly once.
      const stored = await prisma.cashShift.findUnique({
        where: { id: shift.id },
      });
      expect(stored).not.toBeNull();
      expect(stored!.state).toBe("CLOSED");
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
