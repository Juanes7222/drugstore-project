/**
 * Unit tests for getLocalAuditEntries — dispatches to LocalAuditLog or
 * InventoryMovement based on module filter.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { getLocalAuditEntries } from "./audit.service";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const localAuditLog = {
    findMany: vi.fn(),
    count: vi.fn(),
  };

  const prisma = {
    localAuditLog,
    $queryRawUnsafe: vi.fn(),
  } as any;

  return { prisma, localAuditLog };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("getLocalAuditEntries", () => {
  let prisma: any;
  let localAuditLog: ReturnType<typeof vi.fn> & { findMany: any; count: any };

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    localAuditLog = mocks.localAuditLog;
  });

  describe("INVENTORY module", () => {
    it("reads from InventoryMovement via $queryRawUnsafe", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: 2n }])  // COUNT query
        .mockResolvedValueOnce([                   // data query
          {
            id: "mov-1",
            movement_type: "SALE",
            quantity: 5,
            previous_stock: 20,
            resulting_stock: 15,
            created_by_id: "user-1",
            created_at: new Date("2026-07-15T10:00:00Z"),
            lot_id: "lot-1",
            reason: "Venta directa",
            batch_number: "BATCH-001",
            product_name: "Acetaminofén 500mg",
          },
          {
            id: "mov-2",
            movement_type: "PURCHASE_RECEIPT",
            quantity: 10,
            previous_stock: 15,
            resulting_stock: 25,
            created_by_id: "user-2",
            created_at: new Date("2026-07-14T08:00:00Z"),
            lot_id: "lot-2",
            reason: null,
            batch_number: "BATCH-002",
            product_name: "Ibuprofeno 400mg",
          },
        ]);

      const result = await getLocalAuditEntries(prisma, {
        module: "INVENTORY",
        fromDate: "2026-07-01",
        toDate: "2026-07-31",
      });

      expect(result.total).toBe(2);
      expect(result.rows).toHaveLength(2);

      const first = result.rows[0];
      expect(first.id).toBe("mov-1");
      expect(first.action).toBe("INVENTORY_SALE");
      expect(first.userId).toBe("user-1");
      expect(first.entityType).toBe("InventoryMovement");
      expect(first.entityId).toBe("lot-1");
      expect(first.details).toBe("Venta directa");
      expect(first.productName).toBe("Acetaminofén 500mg");
      expect(first.lotBatch).toBe("BATCH-001");

      const second = result.rows[1];
      expect(second.id).toBe("mov-2");
      expect(second.action).toBe("INVENTORY_PURCHASE_RECEIPT");
      expect(second.userId).toBe("user-2");
      expect(second.details).toBeNull();
    });

    it("passes date filters as raw SQL parameters", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: 0n }])
        .mockResolvedValueOnce([]);

      await getLocalAuditEntries(prisma, {
        module: "INVENTORY",
        fromDate: "2026-07-01",
        toDate: "2026-07-15",
      });

      // First call = COUNT, second = data query
      // Both should receive the date params
      const countCall = prisma.$queryRawUnsafe.mock.calls[0];
      expect(countCall[1]).toBe("2026-07-01");
      expect(countCall[2]).toBe("2026-07-15T23:59:59.999Z");
    });

    it("returns empty result when no inventory movements match", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: 0n }])
        .mockResolvedValueOnce([]);

      const result = await getLocalAuditEntries(prisma, {
        module: "INVENTORY",
        fromDate: "2025-01-01",
        toDate: "2025-01-02",
      });

      expect(result.total).toBe(0);
      expect(result.rows).toHaveLength(0);
    });

    it("maps unknown movement_type to the raw value", async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ count: 1n }])
        .mockResolvedValueOnce([
          {
            id: "mov-3",
            movement_type: "CUSTOM_TYPE",
            quantity: 1,
            previous_stock: 10,
            resulting_stock: 9,
            created_by_id: "user-1",
            created_at: new Date("2026-07-20T12:00:00Z"),
            lot_id: "lot-3",
            reason: null,
            batch_number: null,
            product_name: null,
          },
        ]);

      const result = await getLocalAuditEntries(prisma, {
        module: "INVENTORY",
      });

      expect(result.rows[0].action).toBe("CUSTOM_TYPE");
    });
  });

  describe("non-INVENTORY modules (LocalAuditLog)", () => {
    it("reads from LocalAuditLog when module is CASH_SHIFT", async () => {
      localAuditLog.findMany.mockResolvedValue([
        {
          id: "log-1",
          action: "CASH_SHIFT_OPENED",
          createdAt: new Date("2026-07-15T10:00:00Z"),
          userId: "user-1",
          userRole: "CASHIER",
          entityType: "CashShift",
          entityId: "shift-1",
          details: '{"openingBalance":"500000"}',
        },
      ]);
      localAuditLog.count.mockResolvedValue(1);

      const result = await getLocalAuditEntries(prisma, {
        module: "CASH_SHIFT",
      });

      expect(result.total).toBe(1);
      expect(result.rows).toHaveLength(1);

      const row = result.rows[0];
      expect(row.action).toBe("CASH_SHIFT_OPENED");
      expect(row.userId).toBe("user-1");
      expect(row.userRole).toBe("CASHIER");
      expect(row.entityType).toBe("CashShift");
      expect(row.entityId).toBe("shift-1");
      expect(row.details).toBe('{"openingBalance":"500000"}');
    });

    it("maps module to correct category for LocalAuditLog queries", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma, { module: "SYNC" });

      expect(localAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: "sync" }),
        }),
      );
    });

    it("maps SALES module to 'sale' category", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma, { module: "SALES" });

      expect(localAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ category: "sale" }),
        }),
      );
    });

    it("applies action filter when provided", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma, {
        module: "CASH_SHIFT",
        action: "CASH_SHIFT_OPENED",
      });

      const where = localAuditLog.findMany.mock.calls[0][0].where;
      expect(where.action).toBe("CASH_SHIFT_OPENED");
    });

    it("applies date range filter correctly for LocalAuditLog", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma, {
        fromDate: "2026-07-01",
        toDate: "2026-07-15",
      });

      const where = localAuditLog.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toBe("2026-07-01");
      expect(where.createdAt.lte).toBe("2026-07-15T23:59:59.999Z");
    });

    it("applies fromDate only when toDate is omitted", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma, {
        fromDate: "2026-07-01",
      });

      const where = localAuditLog.findMany.mock.calls[0][0].where;
      expect(where.createdAt.gte).toBe("2026-07-01");
      expect(where.createdAt.lte).toBeUndefined();
    });

    it("returns entries ordered by createdAt descending", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma, { module: "AUTH" });

      expect(localAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: "desc" },
        }),
      );
    });

    it("respects limit and offset defaults to 50 and 0", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma, { module: "AUTH" });

      expect(localAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });

    it("respects custom limit and offset", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma, {
        module: "AUTH",
        limit: 10,
        offset: 5,
      });

      expect(localAuditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 5 }),
      );
    });

    it("prefers explicit category over module-derived category", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma, {
        module: "SYNC",
        category: "sale",
      });

      const where = localAuditLog.findMany.mock.calls[0][0].where;
      expect(where.category).toBe("sale");
    });

    it("reads from LocalAuditLog when no module is specified", async () => {
      localAuditLog.findMany.mockResolvedValue([]);
      localAuditLog.count.mockResolvedValue(0);

      await getLocalAuditEntries(prisma);

      expect(localAuditLog.findMany).toHaveBeenCalled();
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it("converts Date createdAt to ISO string", async () => {
      const date = new Date("2026-07-15T10:00:00Z");
      localAuditLog.findMany.mockResolvedValue([
        {
          id: "log-1",
          action: "SALE_CONFIRMED",
          createdAt: date,
          userId: "user-1",
          userRole: null,
          entityType: null,
          entityId: null,
          details: null,
        },
      ]);
      localAuditLog.count.mockResolvedValue(1);

      const result = await getLocalAuditEntries(prisma, { module: "SALES" });

      expect(result.rows[0].createdAt).toBe("2026-07-15T10:00:00.000Z");
    });

    it("handles string createdAt values", async () => {
      localAuditLog.findMany.mockResolvedValue([
        {
          id: "log-1",
          action: "SALE_CONFIRMED",
          createdAt: "2026-07-15T10:00:00.000Z",
          userId: undefined,
          userRole: null,
          entityType: undefined,
          entityId: undefined,
          details: null,
        },
      ]);
      localAuditLog.count.mockResolvedValue(1);

      const result = await getLocalAuditEntries(prisma, { module: "SALES" });

      expect(result.rows[0].createdAt).toBe("2026-07-15T10:00:00.000Z");
      expect(result.rows[0].userId).toBeUndefined();
    });
  });
});
