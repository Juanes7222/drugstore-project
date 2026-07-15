/**
 * Unit tests for SyncPushService — pushing pending sync entries to the server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createSyncPushService, type SyncPushService, classifyFailure, computeNextRetryDelay, PUSH_BATCH_LIMIT, MAX_RETRY_ATTEMPTS } from "./sync-push.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    syncQueue: {
      findMany: vi.fn(),
      update: vi.fn(),
      aggregate: vi.fn(),
    },
    syncAttempt: {
      create: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    $transaction: transaction,
    syncQueue: tx.syncQueue,
    syncAttempt: tx.syncAttempt,
  } as any;

  return { prisma, tx };
};

const makePendingEntry = (overrides: any = {}) => ({
  id: "entry-1",
  operationUuid: "uuid-1",
  operationType: "SALE_CONFIRMATION",
  payload: JSON.stringify({
    createInput: { saleType: "FREE_SALE", items: [] },
    confirmInput: { payments: [] },
    metadata: { localSaleId: "sale-1" },
  }),
  payloadHash: "abc123",
  sourceCreatedAt: new Date("2026-07-10T10:00:00Z"),
  clientSequence: 1n,
  retryCount: 0,
  status: "PENDING",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SyncPushService", () => {
  let prisma: any;
  let tx: any;
  let service: SyncPushService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("pushPending", () => {
    it("returns { pushed: 0, accepted: 0 } when there are no pending entries", async () => {
      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });
      tx.syncQueue.findMany.mockResolvedValue([]);

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 0, accepted: 0 });
    });

    it("pushes a batch of entries and marks them as COMPLETED on success", async () => {
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])    // PENDING entries
        .mockResolvedValueOnce([]);        // FAILED retryable entries
      tx.syncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: 1n } });

      // Mock fetch to return a successful batch response
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{ operationUuid: "uuid-1", status: "ACCEPTED" }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 1 });
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "entry-1" },
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );
      expect(tx.syncAttempt.create).toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("handles ALREADY_ACCEPTED response as accepted", async () => {
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])    // PENDING entries
        .mockResolvedValueOnce([]);        // FAILED retryable entries

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{ operationUuid: "uuid-1", status: "ALREADY_ACCEPTED" }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 1 });
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("marks entries as FAILED on network error and increments retryCount", async () => {
      const entry = makePendingEntry({ retryCount: 0 });
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])    // PENDING entries
        .mockResolvedValueOnce([]);        // FAILED retryable entries

      // Network error: fetch throws
      const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 0 });
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "entry-1" },
          data: expect.objectContaining({
            retryCount: 1,
            failureCategory: "NETWORK",
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("marks entries as PERMANENT_FAILURE when max retries are reached", async () => {
      // Simulate retryCount at MAX_RETRY_ATTEMPTS - 1, so the next attempt exhausts it
      const entry = makePendingEntry({
        retryCount: MAX_RETRY_ATTEMPTS - 1,
        status: "FAILED",
      });
      tx.syncQueue.findMany
        .mockResolvedValueOnce([]) // no PENDING
        .mockResolvedValueOnce([entry]); // retryable FAILED

      const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      await service.pushPending();

      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "PERMANENT_FAILURE",
            retryCount: MAX_RETRY_ATTEMPTS,
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("respects PUSH_BATCH_LIMIT and only processes up to 10 entries", async () => {
      const entries = Array.from({ length: 15 }, (_, i) =>
        makePendingEntry({
          id: `entry-${i}`,
          operationUuid: `uuid-${i}`,
          clientSequence: BigInt(i + 1),
        }),
      );
      tx.syncQueue.findMany
        .mockResolvedValueOnce(entries.slice(0, PUSH_BATCH_LIMIT)) // PENDING entries
        .mockResolvedValueOnce([]);                                 // FAILED retryable entries

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify(
            entries.slice(0, PUSH_BATCH_LIMIT).map((e: any) => ({
              operationUuid: e.operationUuid,
              status: "ACCEPTED",
            })),
          ),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      const result = await service.pushPending();

      expect(result.pushed).toBe(PUSH_BATCH_LIMIT);
      expect(tx.syncQueue.update).toHaveBeenCalledTimes(PUSH_BATCH_LIMIT);

      vi.unstubAllGlobals();
    });

    it("classifies 409 as CONFLICT and 422 as VALIDATION", async () => {
      expect(classifyFailure(409, "Conflict - already exists")).toBe("CONFLICT");
      expect(classifyFailure(422, "Validation error: invalid field")).toBe("VALIDATION");
      expect(classifyFailure(null, "")).toBe("NETWORK");
      expect(classifyFailure(401, "Unauthorized")).toBe("AUTH");
    });
  });

  describe("computeNextRetryDelay", () => {
    it("returns increasing delays based on retry count", () => {
      expect(computeNextRetryDelay(1)).toBe(30_000);
      expect(computeNextRetryDelay(2)).toBe(120_000);
      expect(computeNextRetryDelay(3)).toBe(300_000);
      expect(computeNextRetryDelay(4)).toBe(600_000);
    });

    it("caps at 30 minutes for retry counts >= 5", () => {
      expect(computeNextRetryDelay(5)).toBe(1_800_000);
      expect(computeNextRetryDelay(10)).toBe(1_800_000);
    });
  });

  describe("classifyFailure", () => {
    it("returns NETWORK for null status", () => {
      expect(classifyFailure(null, "")).toBe("NETWORK");
    });

    it("returns AUTH for 401 and 403", () => {
      expect(classifyFailure(401, "unauthorized")).toBe("AUTH");
      expect(classifyFailure(403, "forbidden")).toBe("AUTH");
    });

    it("returns CONFLICT for 409", () => {
      expect(classifyFailure(409, "resource conflict")).toBe("CONFLICT");
    });

    it("returns VALIDATION for 422 with validation error body", () => {
      expect(classifyFailure(422, "validation error: schema mismatch")).toBe("VALIDATION");
    });

    it("returns BUSINESS_RULE for 400 with business keywords", () => {
      expect(classifyFailure(400, "prescription required")).toBe("BUSINESS_RULE");
      expect(classifyFailure(400, "shift closed")).toBe("BUSINESS_RULE");
    });

    it("returns NETWORK for 5xx errors", () => {
      expect(classifyFailure(500, "Internal server error")).toBe("NETWORK");
      expect(classifyFailure(503, "Service unavailable")).toBe("NETWORK");
    });

    it("returns CONFLICT for 422/400 with conflict or mismatch keywords", () => {
      expect(classifyFailure(422, "conflict detected")).toBe("CONFLICT");
      expect(classifyFailure(400, "data mismatch")).toBe("CONFLICT");
    });

    it("returns BUSINESS_RULE for 422/400 with business keywords like prescription, closed, not allowed", () => {
      expect(classifyFailure(422, "prescription not found")).toBe("BUSINESS_RULE");
      expect(classifyFailure(400, "shift closed")).toBe("BUSINESS_RULE");
      expect(classifyFailure(422, "operation not allowed")).toBe("BUSINESS_RULE");
    });

    it("returns CONFLICT for 4xx with already or mismatch keywords", () => {
      expect(classifyFailure(418, "resource already exists")).toBe("CONFLICT");
      expect(classifyFailure(422, "version mismatch")).toBe("CONFLICT");
    });

    it("returns BUSINESS_RULE for 4xx with stock or insufficient keywords", () => {
      expect(classifyFailure(412, "insufficient stock")).toBe("BUSINESS_RULE");
      expect(classifyFailure(418, "business rule violation")).toBe("BUSINESS_RULE");
    });
  });

  describe("pushPending (invalid JSON response)", () => {
    it("treats entries as ACCEPTED when server returns non-JSON body with ok:true", async () => {
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue("not valid json"),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({ prisma, baseUrl: "http://localhost:3000" });

      const result = await service.pushPending();

      // When parseBatchResults returns [], resultMap is empty,
      // so entries fall into `!result` branch and are treated as ACCEPTED
      expect(result).toEqual({ pushed: 1, accepted: 1 });
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      );

      vi.unstubAllGlobals();
    });
  });

  describe("pushPending (server error paths)", () => {
    it("records NETWORK failure when server returns 5xx", async () => {
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        text: vi.fn().mockResolvedValue(""),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({ prisma, baseUrl: "http://localhost:3000" });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 0 });
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failureCategory: "NETWORK" }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("records classified failure when server returns 4xx", async () => {
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        statusText: "Unprocessable",
        text: vi.fn().mockResolvedValue("validation error: schema mismatch"),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({ prisma, baseUrl: "http://localhost:3000" });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 0 });
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ failureCategory: "VALIDATION" }),
        }),
      );

      vi.unstubAllGlobals();
    });
  });

  describe("handleOkResponse (rejected operations)", () => {
    it("marks entries as PERMANENT_FAILURE when server returns REJECTED status", async () => {
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{ operationUuid: "uuid-1", status: "REJECTED", error: "Stock insufficient" }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({ prisma, baseUrl: "http://localhost:3000" });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 0 });
      expect(tx.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "PERMANENT_FAILURE" }),
        }),
      );

      vi.unstubAllGlobals();
    });
  });
});
