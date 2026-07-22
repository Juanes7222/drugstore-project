/**
 * Unit tests for LocalAuditWriter — writes and error handling.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  LocalAuditWriter,
  createLocalAuditWriter,
  LocalAuditEvent,
} from "./local-audit-writer.service";
import type { LocalAuditEventType } from "./local-audit-writer.service";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const localAuditLog = {
    create: vi.fn(),
  };

  const prisma = {
    localAuditLog,
  } as any;

  return { prisma, localAuditLog };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LocalAuditEvent", () => {
  it("defines all expected event constants and no duplicates", () => {
    const values = Object.values(LocalAuditEvent);
    const unique = new Set(values);

    expect(unique.size).toBe(values.length);
  });

  it("includes cash-shift events", () => {
    expect(LocalAuditEvent.CASH_SHIFT_OPENED).toBe("CASH_SHIFT_OPENED");
    expect(LocalAuditEvent.CASH_SHIFT_CLOSED).toBe("CASH_SHIFT_CLOSED");
    expect(LocalAuditEvent.CASH_SHIFT_FORCED_CLOSE).toBe("CASH_SHIFT_FORCED_CLOSE");
    expect(LocalAuditEvent.CASH_COUNT_PARTIAL).toBe("CASH_COUNT_PARTIAL");
  });

  it("includes sale events", () => {
    expect(LocalAuditEvent.SALE_CONFIRMED).toBe("SALE_CONFIRMED");
    expect(LocalAuditEvent.SALE_ANNULLED).toBe("SALE_ANNULLED");
  });

  it("includes client events", () => {
    expect(LocalAuditEvent.CLIENT_CREATED).toBe("CLIENT_CREATED");
    expect(LocalAuditEvent.CLIENT_UPDATED).toBe("CLIENT_UPDATED");
    expect(LocalAuditEvent.CLIENT_DEACTIVATED).toBe("CLIENT_DEACTIVATED");
    expect(LocalAuditEvent.CLIENT_RETURN_CONFIRMED).toBe("CLIENT_RETURN_CONFIRMED");
  });

  it("includes prescription events", () => {
    expect(LocalAuditEvent.PRESCRIPTION_REGISTERED).toBe("PRESCRIPTION_REGISTERED");
  });

  it("includes auth events", () => {
    expect(LocalAuditEvent.OFFLINE_LOGIN).toBe("OFFLINE_LOGIN");
    expect(LocalAuditEvent.OFFLINE_SESSION_BLESSED).toBe("OFFLINE_SESSION_BLESSED");
    expect(LocalAuditEvent.OFFLINE_SESSION_REJECTED).toBe("OFFLINE_SESSION_REJECTED");
  });

  it("includes sync events", () => {
    expect(LocalAuditEvent.SYNC_PUSH_COMPLETED).toBe("SYNC_PUSH_COMPLETED");
    expect(LocalAuditEvent.SYNC_PUSH_FAILED).toBe("SYNC_PUSH_FAILED");
    expect(LocalAuditEvent.SYNC_PULL_COMPLETED).toBe("SYNC_PULL_COMPLETED");
    expect(LocalAuditEvent.SYNC_CONFLICT).toBe("SYNC_CONFLICT");
  });

  it("includes inventory events", () => {
    expect(LocalAuditEvent.INVENTORY_ADJUSTMENT_CREATED).toBe("INVENTORY_ADJUSTMENT_CREATED");
    expect(LocalAuditEvent.INVENTORY_ADJUSTMENT_APPLIED).toBe("INVENTORY_ADJUSTMENT_APPLIED");
    expect(LocalAuditEvent.INVENTORY_ADJUSTMENT_APPROVED).toBe("INVENTORY_ADJUSTMENT_APPROVED");
    expect(LocalAuditEvent.INVENTORY_ADJUSTMENT_REJECTED).toBe("INVENTORY_ADJUSTMENT_REJECTED");
  });

  it("includes purchase events", () => {
    expect(LocalAuditEvent.PURCHASE_ORDER_CREATED).toBe("PURCHASE_ORDER_CREATED");
    expect(LocalAuditEvent.PURCHASE_RECEPTION_CONFIRMED).toBe("PURCHASE_RECEPTION_CONFIRMED");
  });

  it("includes fiscal events", () => {
    expect(LocalAuditEvent.FISCAL_INVOICE_EMITTED).toBe("FISCAL_INVOICE_EMITTED");
    expect(LocalAuditEvent.FISCAL_CONTINGENCY_ACTIVATED).toBe("FISCAL_CONTINGENCY_ACTIVATED");
    expect(LocalAuditEvent.FISCAL_TRANSMISSION_FAILED).toBe("FISCAL_TRANSMISSION_FAILED");
  });
});

describe("LocalAuditWriter", () => {
  let prisma: any;
  let localAuditLog: ReturnType<typeof vi.fn>;
  let writer: LocalAuditWriter;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    localAuditLog = mocks.localAuditLog;
    writer = createLocalAuditWriter(prisma);
  });

  describe("write", () => {
    it("inserts a row into LocalAuditLog with all provided fields", async () => {
      localAuditLog.create.mockResolvedValue({ id: "log-1" });

      await writer.write(LocalAuditEvent.CASH_SHIFT_OPENED, {
        category: "cash_shift",
        entityType: "CashShift",
        entityId: "shift-1",
        entityName: "Turno mañana",
        userId: "user-1",
        userRole: "CASHIER",
        workstationId: "ws-1",
        sessionId: "sess-1",
        correlationId: "corr-1",
        details: { openingBalance: "500000" },
      });

      expect(localAuditLog.create).toHaveBeenCalledTimes(1);
      const callData = localAuditLog.create.mock.calls[0][0].data;

      expect(callData.action).toBe("CASH_SHIFT_OPENED");
      expect(callData.category).toBe("cash_shift");
      expect(callData.entityType).toBe("CashShift");
      expect(callData.entityId).toBe("shift-1");
      expect(callData.entityName).toBe("Turno mañana");
      expect(callData.userId).toBe("user-1");
      expect(callData.userRole).toBe("CASHIER");
      expect(callData.workstationId).toBe("ws-1");
      expect(callData.sessionId).toBe("sess-1");
      expect(callData.correlationId).toBe("corr-1");
      expect(callData.details).toBe('{"openingBalance":"500000"}');
      expect(callData.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
      expect(callData.createdAt).toBeInstanceOf(Date);
    });

    it("inserts a row with minimal fields (category only)", async () => {
      localAuditLog.create.mockResolvedValue({ id: "log-2" });

      await writer.write(LocalAuditEvent.SYNC_PULL_COMPLETED, {
        category: "sync",
      });

      expect(localAuditLog.create).toHaveBeenCalledTimes(1);
      const callData = localAuditLog.create.mock.calls[0][0].data;

      expect(callData.action).toBe("SYNC_PULL_COMPLETED");
      expect(callData.category).toBe("sync");
      expect(callData.entityType).toBeNull();
      expect(callData.entityId).toBeNull();
      expect(callData.entityName).toBeNull();
      expect(callData.userId).toBeNull();
      expect(callData.userRole).toBeNull();
      expect(callData.workstationId).toBeNull();
      expect(callData.sessionId).toBeNull();
      expect(callData.correlationId).toBeNull();
      expect(callData.details).toBeNull();
    });

    it("nullifies details when none are provided", async () => {
      localAuditLog.create.mockResolvedValue({ id: "log-3" });

      await writer.write(LocalAuditEvent.SYNC_PULL_COMPLETED, {
        category: "sync",
      });

      const callData = localAuditLog.create.mock.calls[0][0].data;
      expect(callData.details).toBeNull();
    });

    it("does not throw when prisma.create fails (fire-and-forget)", async () => {
      localAuditLog.create.mockRejectedValue(new Error("DB connection lost"));

      await expect(
        writer.write(LocalAuditEvent.CASH_SHIFT_OPENED, {
          category: "cash_shift",
        }),
      ).resolves.toBeUndefined();
    });

    it("does not throw when prisma.create throws a non-Error value", async () => {
      localAuditLog.create.mockRejectedValue("string error");

      await expect(
        writer.write(LocalAuditEvent.CASH_SHIFT_OPENED, {
          category: "cash_shift",
        }),
      ).resolves.toBeUndefined();
    });

    it("writes all action types without throwing", async () => {
      localAuditLog.create.mockResolvedValue({ id: "log" });

      const actions = Object.values(LocalAuditEvent) as LocalAuditEventType[];
      for (const action of actions) {
        await expect(
          writer.write(action, { category: "sync" }),
        ).resolves.toBeUndefined();
      }

      expect(localAuditLog.create).toHaveBeenCalledTimes(actions.length);
    });
  });

  describe("createLocalAuditWriter factory", () => {
    it("returns a LocalAuditWriter instance", () => {
      const instance = createLocalAuditWriter(prisma);
      expect(instance).toBeInstanceOf(LocalAuditWriter);
    });
  });
});
