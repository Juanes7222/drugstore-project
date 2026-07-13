/**
 * Unit tests for SyncMetricsService — queue counts, failure breakdown, exports.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createSyncMetricsService, type SyncMetricsService, STALE_PENDING_THRESHOLD_MS } from "./sync-metrics.service";
import { DomainError } from "../../common/domain-error";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

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
});
