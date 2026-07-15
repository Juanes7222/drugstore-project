/**
 * Unit tests for SyncMetricsService — queue counts, failure breakdown, exports.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSyncMetricsService, type SyncMetricsService, STALE_PENDING_THRESHOLD_MS } from "./sync-metrics.service";
import { DomainError } from "../../common/domain-error";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../backup/backup.service', () => ({
  createBackupService: vi.fn(() => ({
    getBackupSummary: vi.fn().mockResolvedValue({
      lastBackupAt: '2026-07-10T12:00:00Z',
      lastBackupReason: 'MANUAL',
      totalBackups: 5,
      oldestBackupAt: '2026-06-01T00:00:00Z',
      totalBackupSizeBytes: 1_048_576,
    }),
    getBackupHealth: vi.fn().mockResolvedValue('HEALTHY' as const),
  })),
}));

const makeMockPrisma = () => {
  const prisma = {
    syncQueue: {
      count: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    contingencyEvent: { findFirst: vi.fn() },
    invoice: { count: vi.fn() },
    invoiceLocalAdjustment: { findMany: vi.fn() },
  } as any;

  return { prisma };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncMetricsService", () => {
  let prisma: any;
  let service: SyncMetricsService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    service = createSyncMetricsService(prisma);
  });

  describe("getQueueCounts", () => {
    it("returns all queue counts correctly with mixed data", async () => {
      prisma.syncQueue.count
        .mockResolvedValueOnce(5)   // pending
        .mockResolvedValueOnce(2)   // stalePending
        .mockResolvedValueOnce(3)   // failed
        .mockResolvedValueOnce(1)   // permanentFailure
        .mockResolvedValueOnce(20)  // completed24h
        .mockResolvedValueOnce(100);// completedTotal

      const counts = await service.getQueueCounts();

      expect(counts).toEqual({
        pending: 5,
        stalePending: 2,
        failed: 3,
        permanentFailure: 1,
        completed24h: 20,
        completedTotal: 100,
      });
    });

    it("returns all zeros when the queue is empty", async () => {
      prisma.syncQueue.count.mockResolvedValue(0);

      const counts = await service.getQueueCounts();

      expect(counts).toEqual({
        pending: 0,
        stalePending: 0,
        failed: 0,
        permanentFailure: 0,
        completed24h: 0,
        completedTotal: 0,
      });
    });

    it("counts stale pending entries (older than 1 hour)", async () => {
      const now = Date.now();
      vi.useFakeTimers().setSystemTime(now);

      prisma.syncQueue.count
        .mockResolvedValueOnce(3)   // pending
        .mockResolvedValueOnce(1)   // stalePending — one is old
        .mockResolvedValueOnce(0)   // failed
        .mockResolvedValueOnce(0)   // permanentFailure
        .mockResolvedValueOnce(5)   // completed24h
        .mockResolvedValueOnce(50); // completedTotal

      const counts = await service.getQueueCounts();

      expect(counts.stalePending).toBe(1);
      expect(prisma.syncQueue.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "PENDING",
            sourceCreatedAt: { lt: new Date(now - STALE_PENDING_THRESHOLD_MS) },
          }),
        }),
      );

      vi.useRealTimers();
    });
  });

  describe("getFailureBreakdown", () => {
    it("groups failures by category with counts and mostRecent", async () => {
      const since = new Date("2026-07-01");
      prisma.syncQueue.findMany.mockResolvedValue([
        { failureCategory: "NETWORK", lastAttemptAt: new Date("2026-07-10T12:00:00Z") },
        { failureCategory: "NETWORK", lastAttemptAt: new Date("2026-07-10T10:00:00Z") },
        { failureCategory: "VALIDATION", lastAttemptAt: new Date("2026-07-10T14:00:00Z") },
      ]);

      const breakdown = await service.getFailureBreakdown(since);

      expect(breakdown).toHaveLength(2);
      const network = breakdown.find((b) => b.category === "NETWORK");
      expect(network?.count).toBe(2);
      expect(network?.mostRecent).toBe("2026-07-10T12:00:00.000Z");
    });
  });

  describe("getPermanentFailureEntries", () => {
    it("returns paginated permanent failure entries", async () => {
      prisma.syncQueue.count.mockResolvedValue(1);
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "pf-1",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-pf",
          payloadHash: "hash123",
          failureCategory: "VALIDATION",
          lastErrorMessage: "Invalid data",
          retryCount: 10,
          sourceCreatedAt: new Date("2026-07-10"),
          lastAttemptAt: new Date("2026-07-11"),
          payload: JSON.stringify({ metadata: { localNumber: 42 } }),
        },
      ]);

      const result = await service.getPermanentFailureEntries({ limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.hasMore).toBe(false);
      expect(result.data[0].operationType).toBe("SALE_CONFIRMATION");
    });

    it("filters by category when provided", async () => {
      prisma.syncQueue.count.mockResolvedValue(0);
      prisma.syncQueue.findMany.mockResolvedValue([]);

      await service.getPermanentFailureEntries({ category: "VALIDATION" });

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            failureCategory: "VALIDATION",
          }),
        }),
      );
    });

    it("renders payload preview for CLIENT_RETURN operation", async () => {
      prisma.syncQueue.count.mockResolvedValue(1);
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "pf-2",
          operationType: "CLIENT_RETURN",
          operationUuid: "uuid-return",
          payloadHash: "hash456",
          failureCategory: "VALIDATION",
          lastErrorMessage: null,
          retryCount: 0,
          sourceCreatedAt: new Date("2026-07-10"),
          lastAttemptAt: null,
          payload: JSON.stringify({ receiptNumber: 999 }),
        },
      ]);

      const result = await service.getPermanentFailureEntries({ limit: 20 });

      expect(result.data[0].payloadPreview).toBe("Return receipt #999");
    });

    it("renders payload preview for INVENTORY_ADJUSTMENT operation", async () => {
      prisma.syncQueue.count.mockResolvedValue(1);
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "pf-3",
          operationType: "INVENTORY_ADJUSTMENT",
          operationUuid: "uuid-adj",
          payloadHash: "hash789",
          failureCategory: "VALIDATION",
          lastErrorMessage: null,
          retryCount: 0,
          sourceCreatedAt: new Date("2026-07-10"),
          lastAttemptAt: null,
          payload: JSON.stringify({ lotId: "L-42" }),
        },
      ]);

      const result = await service.getPermanentFailureEntries({ limit: 20 });

      expect(result.data[0].payloadPreview).toBe("Adjustment lotId: L-42");
    });

    it("handles unparseable payload in permanent failure entry", async () => {
      prisma.syncQueue.count.mockResolvedValue(1);
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "pf-4",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-bad",
          payloadHash: "hash000",
          failureCategory: "VALIDATION",
          lastErrorMessage: null,
          retryCount: 0,
          sourceCreatedAt: new Date("2026-07-10"),
          lastAttemptAt: null,
          payload: "{invalid",
        },
      ]);

      const result = await service.getPermanentFailureEntries({ limit: 20 });

      expect(result.data[0].payloadPreview).toBe("(unparseable payload)");
    });
  });

  describe("getSyncHealthTimeline", () => {
    it("returns hourly buckets with completed and non-completed counts", async () => {
      const now = new Date("2026-07-10T15:00:00Z");
      vi.useFakeTimers().setSystemTime(now);

      prisma.syncQueue.findMany.mockResolvedValue([
        { status: "COMPLETED", lastAttemptAt: new Date("2026-07-10T14:30:00Z") },
        { status: "COMPLETED", lastAttemptAt: new Date("2026-07-10T14:15:00Z") },
        { status: "FAILED", lastAttemptAt: new Date("2026-07-10T13:45:00Z") },
      ]);

      const timeline = await service.getSyncHealthTimeline(3);

      expect(timeline).toHaveLength(3);
      const bucket14 = timeline.find((b) => b.id.includes("14:00:00"));
      expect(bucket14?.completed).toBe(2);
      const bucket13 = timeline.find((b) => b.id.includes("13:00:00"));
      expect(bucket13?.nonCompleted).toBe(1);

      vi.useRealTimers();
    });
  });

  describe("exportEntriesAsCsv", () => {
    it("generates CSV with headers and data rows", async () => {
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "e-1",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-1",
          status: "COMPLETED",
          retryCount: 0,
          failureCategory: null,
          lastErrorMessage: null,
          nextRetryAt: null,
          lastAttemptAt: new Date("2026-07-10T12:00:00Z"),
          sourceWorkstationId: "ws-1",
          sourceCreatedAt: new Date("2026-07-10T11:00:00Z"),
          clientSequence: 1n,
          payloadHash: "abc",
          payloadSize: 100,
          versionSchema: 1,
          receivedAt: null,
          processedAt: null,
          correlationId: null,
          workstationId: null,
          payload: "{}",
        },
      ]);

      const csv = await service.exportEntriesAsCsv({});

      expect(csv).toContain("id,operationType,operationUuid");
      expect(csv).toContain("e-1,SALE_CONFIRMATION,uuid-1");
    });

    it("throws when export exceeds row limit", async () => {
      // Mock more than 10000 results
      const manyResults = Array.from({ length: 10001 }, (_, i) => ({
        id: `e-${i}`,
        operationType: "SALE_CONFIRMATION",
        operationUuid: `u-${i}`,
        status: "PENDING",
        retryCount: 0,
        failureCategory: null,
        lastErrorMessage: null,
        nextRetryAt: null,
        lastAttemptAt: null,
        sourceWorkstationId: "ws-1",
        sourceCreatedAt: new Date(),
        clientSequence: BigInt(i + 1),
        payloadHash: "abc",
        payloadSize: 0,
        versionSchema: 1,
        receivedAt: null,
        processedAt: null,
        correlationId: null,
        workstationId: null,
        payload: "{}",
      }));
      prisma.syncQueue.findMany.mockResolvedValue(manyResults);

      await expect(service.exportEntriesAsCsv({})).rejects.toThrow(DomainError);
    });

    it("handles invalid JSON payload and special first characters in CSV cells", async () => {
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "e-1",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-1",
          status: "COMPLETED",
          retryCount: 0,
          failureCategory: null,
          lastErrorMessage: "=SUM(A1:A10)",
          nextRetryAt: null,
          lastAttemptAt: new Date("2026-07-10T12:00:00Z"),
          sourceWorkstationId: "ws-1",
          sourceCreatedAt: new Date("2026-07-10T11:00:00Z"),
          clientSequence: 1n,
          payloadHash: "abc",
          payloadSize: 100,
          versionSchema: 1,
          receivedAt: null,
          processedAt: null,
          correlationId: null,
          workstationId: null,
          payload: "{invalid",
        },
      ]);

      const csv = await service.exportEntriesAsCsv({});

      // lastErrorMessage starts with '=' → should be prefixed with "'"
      expect(csv).toContain("'=SUM(A1:A10)");
      // Invalid JSON payload is returned as-is by prettyPrintPayload catch
      expect(csv).toContain("{invalid");
    });

    it("wraps CSV cells containing commas and quotes", async () => {
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "e-1",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-1",
          status: "COMPLETED",
          retryCount: 0,
          failureCategory: null,
          lastErrorMessage: 'contains "quotes" and, commas',
          nextRetryAt: null,
          lastAttemptAt: null,
          sourceWorkstationId: "ws-1",
          sourceCreatedAt: new Date("2026-07-10T11:00:00Z"),
          clientSequence: 1n,
          payloadHash: "abc",
          payloadSize: 100,
          versionSchema: 1,
          receivedAt: null,
          processedAt: null,
          correlationId: null,
          workstationId: null,
          payload: "{}",
        },
      ]);

      const csv = await service.exportEntriesAsCsv({});

      expect(csv).toContain('"contains ""quotes"" and, commas"');
    });
  });

  describe("exportEntriesAsJson", () => {
    it("generates a JSON array string", async () => {
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "e-1",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-1",
          status: "COMPLETED",
          retryCount: 0,
          failureCategory: null,
          lastErrorMessage: null,
          nextRetryAt: null,
          lastAttemptAt: new Date("2026-07-10T12:00:00Z"),
          sourceWorkstationId: "ws-1",
          sourceCreatedAt: new Date("2026-07-10T11:00:00Z"),
          clientSequence: 1n,
          payloadHash: "abc",
          payloadSize: 100,
          versionSchema: 1,
          receivedAt: null,
          processedAt: null,
          correlationId: null,
          workstationId: null,
          payload: "{}",
        },
      ]);

      const json = await service.exportEntriesAsJson({});

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].operationType).toBe("SALE_CONFIRMATION");
    });

    it("handles invalid JSON payload in JSON export", async () => {
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "e-1",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-1",
          status: "COMPLETED",
          retryCount: 0,
          failureCategory: null,
          lastErrorMessage: null,
          nextRetryAt: null,
          lastAttemptAt: null,
          sourceWorkstationId: "ws-1",
          sourceCreatedAt: new Date("2026-07-10T11:00:00Z"),
          clientSequence: 1n,
          payloadHash: "abc",
          payloadSize: 100,
          versionSchema: 1,
          receivedAt: null,
          processedAt: null,
          correlationId: null,
          workstationId: null,
          payload: "{invalid",
        },
      ]);

      const json = await service.exportEntriesAsJson({});

      expect(() => JSON.parse(json)).not.toThrow();
      const parsed = JSON.parse(json);
      expect(parsed).toHaveLength(1);
      // tryParsePayload returns null for invalid JSON
      expect(parsed[0].parsedPayload).toBeNull();
    });

    it("throws when export exceeds row limit", async () => {
      const manyResults = Array.from({ length: 10001 }, (_, i) => ({
        id: `e-${i}`,
        operationType: "SALE_CONFIRMATION",
        operationUuid: `u-${i}`,
        status: "PENDING",
        retryCount: 0,
        failureCategory: null,
        lastErrorMessage: null,
        nextRetryAt: null,
        lastAttemptAt: null,
        sourceWorkstationId: "ws-1",
        sourceCreatedAt: new Date(),
        clientSequence: BigInt(i + 1),
        payloadHash: "abc",
        payloadSize: 0,
        versionSchema: 1,
        receivedAt: null,
        processedAt: null,
        correlationId: null,
        workstationId: null,
        payload: "{}",
      }));
      prisma.syncQueue.findMany.mockResolvedValue(manyResults);

      await expect(service.exportEntriesAsJson({})).rejects.toThrow(DomainError);
    });
  });

  describe("getStalePendingEntries", () => {
    it("returns paginated stale pending entries", async () => {
      prisma.syncQueue.count.mockResolvedValue(1);
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "stale-1",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-stale",
          payloadHash: "hash",
          failureCategory: null,
          lastErrorMessage: null,
          retryCount: 0,
          sourceCreatedAt: new Date("2026-01-01"),
          lastAttemptAt: null,
          payload: "{}",
        },
      ]);

      const result = await service.getStalePendingEntries({ limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe("exportEntriesAsCsv — fetchFilteredEntries filters", () => {
    it("passes since/until to the database query", async () => {
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "e-1",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-1",
          status: "COMPLETED",
          retryCount: 0,
          failureCategory: null,
          lastErrorMessage: null,
          nextRetryAt: null,
          lastAttemptAt: null,
          sourceWorkstationId: "ws-1",
          sourceCreatedAt: new Date("2026-07-15T12:00:00Z"),
          clientSequence: 1n,
          payloadHash: "abc",
          payloadSize: 100,
          versionSchema: 1,
          receivedAt: null,
          processedAt: null,
          correlationId: null,
          workstationId: null,
          payload: "{}",
        },
      ]);

      const since = new Date("2026-07-01");
      const until = new Date("2026-07-31");
      const csv = await service.exportEntriesAsCsv({ since, until });

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceCreatedAt: expect.objectContaining({
              gte: since,
              lte: until,
            }),
          }),
        }),
      );
      expect(csv).toContain("e-1");
    });

    it("passes only since when until is omitted", async () => {
      prisma.syncQueue.findMany.mockResolvedValue([
        {
          id: "e-2",
          operationType: "SALE_CONFIRMATION",
          operationUuid: "uuid-2",
          status: "COMPLETED",
          retryCount: 0,
          failureCategory: null,
          lastErrorMessage: null,
          nextRetryAt: null,
          lastAttemptAt: null,
          sourceWorkstationId: "ws-1",
          sourceCreatedAt: new Date("2026-07-15T12:00:00Z"),
          clientSequence: 1n,
          payloadHash: "abc",
          payloadSize: 100,
          versionSchema: 1,
          receivedAt: null,
          processedAt: null,
          correlationId: null,
          workstationId: null,
          payload: "{}",
        },
      ]);

      const since = new Date("2026-07-01");
      const csv = await service.exportEntriesAsCsv({ since });

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            sourceCreatedAt: expect.objectContaining({
              gte: since,
            }),
          }),
        }),
      );
      expect(csv).toContain("e-2");
    });
  });

  describe("getFiscalSummary", () => {
    it("returns zeros when no contingency event or invoices exist", async () => {
      prisma.contingencyEvent.findFirst.mockResolvedValue(null);
      prisma.invoice.count.mockResolvedValue(0);

      const result = await service.getFiscalSummary();

      expect(result.contingencyActive).toBe(false);
      expect(result.pendingContingencyInvoices).toBe(0);
      expect(result.expiringWithin24h).toBe(0);
      expect(result.transmittedLast24h).toBe(0);
      expect(result.rejectedLast24h).toBe(0);
      expect(result.expiredContingencyInvoices).toBe(0);
    });

    it("reports active contingency and non-zero counts", async () => {
      prisma.contingencyEvent.findFirst.mockResolvedValue({
        id: "ce-1",
        endedAt: null,
      });
      prisma.invoice.count
        .mockResolvedValueOnce(5)   // pendingContingencyInvoices
        .mockResolvedValueOnce(2)   // expiringWithin24h
        .mockResolvedValueOnce(10)  // transmittedLast24h
        .mockResolvedValueOnce(1)   // rejectedLast24h
        .mockResolvedValueOnce(3);  // expiredContingencyInvoices

      const result = await service.getFiscalSummary();

      expect(result.contingencyActive).toBe(true);
      expect(result.pendingContingencyInvoices).toBe(5);
      expect(result.expiringWithin24h).toBe(2);
      expect(result.transmittedLast24h).toBe(10);
      expect(result.rejectedLast24h).toBe(1);
      expect(result.expiredContingencyInvoices).toBe(3);
    });
  });

  describe("getLocalAdjustmentSummary", () => {
    it("returns empty summary when no recent adjustments", async () => {
      prisma.invoiceLocalAdjustment.findMany.mockResolvedValue([]);

      const result = await service.getLocalAdjustmentSummary();

      expect(result.adjustmentsLast24h).toBe(0);
      expect(result.byType).toEqual({});
      expect(result.reversalsLast24h).toBe(0);
      expect(result.invoicesWithAdjustments).toBe(0);
    });

    it("aggregates adjustments by type including reversals", async () => {
      prisma.invoiceLocalAdjustment.findMany.mockResolvedValue([
        { adjustmentType: "PRICE_CORRECTION", invoiceId: "inv-1" },
        { adjustmentType: "REVERSAL", invoiceId: "inv-1" },
        { adjustmentType: "REVERSAL", invoiceId: "inv-2" },
      ]);

      const result = await service.getLocalAdjustmentSummary();

      expect(result.adjustmentsLast24h).toBe(3);
      expect(result.byType).toEqual({
        PRICE_CORRECTION: 1,
        REVERSAL: 2,
      });
      expect(result.reversalsLast24h).toBe(2);
      expect(result.invoicesWithAdjustments).toBe(2);
    });
  });

  describe("getBackupSummary", () => {
    it("returns backup summary from the backup service", async () => {
      const result = await service.getBackupSummary();

      expect(result.lastBackupAt).toBe('2026-07-10T12:00:00Z');
      expect(result.lastBackupReason).toBe('MANUAL');
      expect(result.totalBackups).toBe(5);
      expect(result.oldestBackupAt).toBe('2026-06-01T00:00:00Z');
      expect(result.totalBackupSizeBytes).toBe(1_048_576);
    });
  });

  describe("getBackupHealth", () => {
    it("returns health level from the backup service", async () => {
      const result = await service.getBackupHealth();

      expect(result).toBe('HEALTHY');
    });
  });
});
