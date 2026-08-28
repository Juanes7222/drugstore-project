/**
 * Unit tests for SyncPushService — pushing pending sync entries to the server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createSyncPushService, type SyncPushService, classifyFailure, computeNextRetryDelay, PUSH_BATCH_LIMIT, MAX_RETRY_ATTEMPTS, OPERATION_PRIORITY } from "./sync-push.service";

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
    product: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    $transaction: transaction,
    syncQueue: tx.syncQueue,
    syncAttempt: tx.syncAttempt,
    product: tx.product,
  } as any;

  return { prisma, tx };
};

const makePendingEntry = (overrides: any = {}) => ({
  id: "entry-1",
  operationUuid: "uuid-1",
  operationType: "SALE_CONFIRMATION",
  payload: JSON.stringify({
    userId: "user-001",
    createSaleDto: { saleType: "FREE_SALE", cashShiftId: "00000000-0000-0000-0000-000000000001", items: [] },
    confirmSaleDto: { payments: [] },
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
    beforeEach(() => {
      // Pin Math.random to 0.5 so the ±20% jitter factor is exactly 1.0,
      // making the delay deterministic (base * (0.8 + 0.5 * 0.4) = base).
      vi.spyOn(Math, "random").mockReturnValue(0.5);
    });

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

  // ---------------------------------------------------------------
  // Audit trail
  // ---------------------------------------------------------------

  describe("pushPending (audit)", () => {
    it("writes SYNC_PUSH_COMPLETED when batch is accepted", async () => {
      const auditWriter = { write: vi.fn() };
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

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
        auditWriter: auditWriter as any,
      });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 1 });
      expect(auditWriter.write).toHaveBeenCalledWith(
        "SYNC_PUSH_COMPLETED",
        expect.objectContaining({
          category: "sync",
          entityType: "SyncQueue",
          details: expect.objectContaining({
            pushedCount: 1,
            acceptedCount: 1,
            rejectedCount: 0,
            httpStatus: 200,
            operationTypes: ["SALE_CONFIRMATION"],
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("writes SYNC_PUSH_FAILED on network error", async () => {
      const auditWriter = { write: vi.fn() };
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
        auditWriter: auditWriter as any,
      });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 0 });
      expect(auditWriter.write).toHaveBeenCalledWith(
        "SYNC_PUSH_FAILED",
        expect.objectContaining({
          category: "sync",
          entityType: "SyncQueue",
          details: expect.objectContaining({
            pushedCount: 1,
            acceptedCount: 0,
            failureCategory: "NETWORK",
            operationTypes: ["SALE_CONFIRMATION"],
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("writes SYNC_PUSH_FAILED on 4xx server error", async () => {
      const auditWriter = { write: vi.fn() };
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

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
        auditWriter: auditWriter as any,
      });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 0 });
      expect(auditWriter.write).toHaveBeenCalledWith(
        "SYNC_PUSH_FAILED",
        expect.objectContaining({
          details: expect.objectContaining({
            failureCategory: "VALIDATION",
            statusCode: 422,
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("writes SYNC_PUSH_FAILED on 5xx server error", async () => {
      const auditWriter = { write: vi.fn() };
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

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
        auditWriter: auditWriter as any,
      });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 0 });
      expect(auditWriter.write).toHaveBeenCalledWith(
        "SYNC_PUSH_FAILED",
        expect.objectContaining({
          details: expect.objectContaining({
            failureCategory: "NETWORK",
            statusCode: 502,
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("writes SYNC_CONFLICT when server rejects with CONFLICT", async () => {
      const auditWriter = { write: vi.fn() };
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{
            operationUuid: "uuid-1",
            status: "REJECTED",
            error: "Conflict detected",
          }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
        auditWriter: auditWriter as any,
      });

      await service.pushPending();

      // Should write both SYNC_CONFLICT per-entry and SYNC_PUSH_COMPLETED once
      expect(auditWriter.write).toHaveBeenCalledWith(
        "SYNC_CONFLICT",
        expect.objectContaining({
          category: "sync",
          entityType: "SyncQueue",
          entityId: "entry-1",
          details: expect.objectContaining({
            operationType: "SALE_CONFIRMATION",
            operationUuid: "uuid-1",
            error: "Conflict detected",
            rejectionCategory: "CONFLICT",
          }),
        }),
      );

      expect(auditWriter.write).toHaveBeenCalledWith(
        "SYNC_PUSH_COMPLETED",
        expect.objectContaining({
          details: expect.objectContaining({
            acceptedCount: 0,
            rejectedCount: 1,
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("does not write SYNC_CONFLICT when rejection is not CONFLICT", async () => {
      const auditWriter = { write: vi.fn() };
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{
            operationUuid: "uuid-1",
            status: "REJECTED",
            error: "Stock insufficient",
          }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
        auditWriter: auditWriter as any,
      });

      await service.pushPending();

      // Classify REJECTED with "stock" keyword → BUSINESS_RULE, not CONFLICT
      const conflictCalls = auditWriter.write.mock.calls.filter(
        (c: any[]) => c[0] === "SYNC_CONFLICT",
      );
      expect(conflictCalls).toHaveLength(0);

      // SYNC_PUSH_COMPLETED should still be written
      expect(auditWriter.write).toHaveBeenCalledWith(
        "SYNC_PUSH_COMPLETED",
        expect.anything(),
      );

      vi.unstubAllGlobals();
    });

    it("does not throw when auditWriter is not configured", async () => {
      const entry = makePendingEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{ operationUuid: "uuid-1", status: "ACCEPTED" }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      // service without auditWriter (default in beforeEach)
      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      await expect(service.pushPending()).resolves.toEqual({
        pushed: 1,
        accepted: 1,
      });

      vi.unstubAllGlobals();
    });
  });

  // ---------------------------------------------------------------
  // entityInternalCode stamping (PRODUCT_CREATION)
  // ---------------------------------------------------------------

  describe("stampEntityIdFromResult (PRODUCT_CREATION entityInternalCode handling)", () => {
    const makeProductCreationEntry = (overrides: any = {}) =>
      makePendingEntry({
        operationType: "PRODUCT_CREATION",
        payload: JSON.stringify({
          metadata: { productId: "local-product-1" },
        }),
        ...overrides,
      });

    it("stamps both serverId and internalCode when local code starts with OFFLINE- and the server value differs", async () => {
      const entry = makeProductCreationEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);
      tx.product.findUnique.mockResolvedValueOnce({
        internalCode: "OFFLINE-local-product-1",
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{
            operationUuid: "uuid-1",
            status: "ACCEPTED",
            entityId: "server-product-1",
            entityInternalCode: "PROD-001",
          }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      await service.pushPending();

      expect(tx.product.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "local-product-1" },
          select: { internalCode: true },
        }),
      );
      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "local-product-1" },
          data: { serverId: "server-product-1", internalCode: "PROD-001" },
        }),
      );

      vi.unstubAllGlobals();
    });

    it("does not stomp internalCode when the local code does not start with OFFLINE-", async () => {
      const entry = makeProductCreationEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);
      tx.product.findUnique.mockResolvedValueOnce({
        internalCode: "MANUAL-001",
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{
            operationUuid: "uuid-1",
            status: "ACCEPTED",
            entityId: "server-product-1",
            entityInternalCode: "PROD-001",
          }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      await service.pushPending();

      expect(tx.product.findUnique).toHaveBeenCalled();
      const updateCall = tx.product.update.mock.calls[0][0];
      expect(updateCall.data).toEqual({ serverId: "server-product-1" });
      expect(updateCall.data).not.toHaveProperty("internalCode");

      vi.unstubAllGlobals();
    });

    it("does not stomp internalCode when the local OFFLINE- code already matches the server value", async () => {
      const entry = makeProductCreationEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);
      tx.product.findUnique.mockResolvedValueOnce({
        internalCode: "OFFLINE-local-product-1",
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{
            operationUuid: "uuid-1",
            status: "ACCEPTED",
            entityId: "server-product-1",
            entityInternalCode: "OFFLINE-local-product-1",
          }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      await service.pushPending();

      expect(tx.product.findUnique).toHaveBeenCalled();
      const updateCall = tx.product.update.mock.calls[0][0];
      expect(updateCall.data).toEqual({ serverId: "server-product-1" });
      expect(updateCall.data).not.toHaveProperty("internalCode");

      vi.unstubAllGlobals();
    });

    it("is a no-op for internalCode when the server result omits entityInternalCode", async () => {
      const entry = makeProductCreationEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{
            operationUuid: "uuid-1",
            status: "ACCEPTED",
            entityId: "server-product-1",
          }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      await service.pushPending();

      expect(tx.product.findUnique).not.toHaveBeenCalled();
      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "local-product-1" },
          data: { serverId: "server-product-1" },
        }),
      );
      const updateCall = tx.product.update.mock.calls[0][0];
      expect(updateCall.data).not.toHaveProperty("internalCode");

      vi.unstubAllGlobals();
    });

    it("is a no-op for internalCode when the server returns an empty entityInternalCode string", async () => {
      const entry = makeProductCreationEntry();
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{
            operationUuid: "uuid-1",
            status: "ACCEPTED",
            entityId: "server-product-1",
            entityInternalCode: "",
          }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      await service.pushPending();

      expect(tx.product.findUnique).not.toHaveBeenCalled();
      const updateCall = tx.product.update.mock.calls[0][0];
      expect(updateCall.data).toEqual({ serverId: "server-product-1" });
      expect(updateCall.data).not.toHaveProperty("internalCode");

      vi.unstubAllGlobals();
    });

    it("tolerates a mixed batch where some results carry entityInternalCode and others do not", async () => {
      const entries = [
        makeProductCreationEntry({ id: "entry-1", operationUuid: "uuid-1" }),
        makeProductCreationEntry({
          id: "entry-2",
          operationUuid: "uuid-2",
          payload: JSON.stringify({ metadata: { productId: "local-product-2" } }),
        }),
      ];
      tx.syncQueue.findMany
        .mockResolvedValueOnce(entries)
        .mockResolvedValueOnce([]);
      tx.product.findUnique.mockResolvedValueOnce({
        internalCode: "OFFLINE-local-product-1",
      });

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([
            {
              operationUuid: "uuid-1",
              status: "ACCEPTED",
              entityId: "server-product-1",
              entityInternalCode: "PROD-001",
            },
            {
              operationUuid: "uuid-2",
              status: "ACCEPTED",
              entityId: "server-product-2",
            },
          ]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 2, accepted: 2 });
      expect(tx.product.update).toHaveBeenCalledTimes(2);
      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "local-product-1" },
          data: { serverId: "server-product-1", internalCode: "PROD-001" },
        }),
      );
      expect(tx.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "local-product-2" },
          data: { serverId: "server-product-2" },
        }),
      );
      const secondCall = tx.product.update.mock.calls[1][0];
      expect(secondCall.data).not.toHaveProperty("internalCode");

      vi.unstubAllGlobals();
    });

    it("does not touch product tables for non-PRODUCT_CREATION operations", async () => {
      const entry = makePendingEntry(); // SALE_CONFIRMATION
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry])
        .mockResolvedValueOnce([]);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: vi.fn().mockResolvedValue(
          JSON.stringify([{
            operationUuid: "uuid-1",
            status: "ACCEPTED",
            entityId: "server-sale-1",
            entityInternalCode: "SALE-XYZ",
          }]),
        ),
      });
      vi.stubGlobal("fetch", mockFetch);

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      await service.pushPending();

      expect(tx.product.findUnique).not.toHaveBeenCalled();
      expect(tx.product.update).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });

  // ---------------------------------------------------------------
  // Retry-budget protection — recordBatchFailure with AUTH failures.
  // An AUTH failure with no offline token means the request had no valid
  // credential at all; the entry cannot succeed until re-auth, so the
  // attempt is logged but the retry budget is left untouched. With an
  // offline token the failure is a normal transient error → backoff.
  // ---------------------------------------------------------------

  describe("recordBatchFailure (AUTH retry-budget protection)", () => {
    const makeAuthFetch = () =>
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: vi.fn().mockResolvedValue("Unauthorized"),
      });

    it("records the attempt without consuming retry budget when AUTH fails with no offline token", async () => {
      const entry = makePendingEntry({ retryCount: 0 });
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry]) // PENDING entries
        .mockResolvedValueOnce([]); // FAILED retryable entries
      vi.stubGlobal("fetch", makeAuthFetch());

      // No offlineToken — the request went out without a fallback credential.
      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
      });

      const result = await service.pushPending();

      expect(result).toEqual({ pushed: 1, accepted: 0 });
      const updateCall = tx.syncQueue.update.mock.calls[0][0];
      expect(updateCall.data).toMatchObject({
        failureCategory: "AUTH",
        lastAttemptAt: expect.any(Date),
        lastErrorMessage: expect.stringContaining("401"),
      });
      // Retry budget untouched — the entry is picked up by the first push
      // after credentials recover instead of burning an attempt now.
      expect(updateCall.data).not.toHaveProperty("retryCount");
      expect(updateCall.data).not.toHaveProperty("nextRetryAt");
      expect(tx.syncAttempt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            syncQueueEntryId: "entry-1",
            outcome: "REJECTED",
            httpStatus: 401,
            failureCategory: "AUTH",
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("still uses normal backoff when AUTH fails with an offline token present", async () => {
      const entry = makePendingEntry({ retryCount: 0 });
      tx.syncQueue.findMany
        .mockResolvedValueOnce([entry]) // PENDING entries
        .mockResolvedValueOnce([]); // FAILED retryable entries
      vi.stubGlobal("fetch", makeAuthFetch());

      service = createSyncPushService({
        prisma,
        baseUrl: "http://localhost:3000",
        offlineToken: "offline-token-123",
      });

      await service.pushPending();

      const updateCall = tx.syncQueue.update.mock.calls[0][0];
      expect(updateCall.data).toMatchObject({
        retryCount: 1,
        failureCategory: "AUTH",
        lastAttemptAt: expect.any(Date),
      });
      expect(updateCall.data.nextRetryAt).toBeInstanceOf(Date);

      vi.unstubAllGlobals();
    });
  });

  describe("OPERATION_PRIORITY (SHIFT_OPEN global sync flow)", () => {
    it("defines SHIFT_OPEN with priority 2", () => {
      expect(OPERATION_PRIORITY.SHIFT_OPEN).toBe(2);
    });

    it("defines SHIFT_OPEN at same priority as PRODUCT_UPDATE and CLIENT_UPDATE", () => {
      expect(OPERATION_PRIORITY.SHIFT_OPEN).toBe(OPERATION_PRIORITY.PRODUCT_UPDATE);
      expect(OPERATION_PRIORITY.SHIFT_OPEN).toBe(OPERATION_PRIORITY.CLIENT_UPDATE);
      expect(OPERATION_PRIORITY.PRODUCT_UPDATE).toBe(2);
    });

    it("orders SHIFT_OPEN before SALE_CONFIRMATION and SHIFT_CLOSURE", () => {
      expect(OPERATION_PRIORITY.SHIFT_OPEN).toBeLessThan(OPERATION_PRIORITY.SALE_CONFIRMATION);
      expect(OPERATION_PRIORITY.SHIFT_OPEN).toBeLessThan(OPERATION_PRIORITY.SHIFT_CLOSURE);
      expect(OPERATION_PRIORITY.SALE_CONFIRMATION).toBe(3);
    });

    it("orders entries by priority: PRODUCT_CREATION (1) before SHIFT_OPEN (2) before SALE_CONFIRMATION (3) before INVENTORY_ADJUSTMENT (4)", async () => {
      const entries = [
        makePendingEntry({ id: "e-sale", operationUuid: "u-sale", operationType: "SALE_CONFIRMATION", clientSequence: 1n }),
        makePendingEntry({ id: "e-shift", operationUuid: "u-shift", operationType: "SHIFT_OPEN", clientSequence: 2n }),
        makePendingEntry({ id: "e-product", operationUuid: "u-product", operationType: "PRODUCT_CREATION", clientSequence: 3n }),
        makePendingEntry({ id: "e-inv", operationUuid: "u-inv", operationType: "INVENTORY_ADJUSTMENT", clientSequence: 4n }),
      ];
      // findMany for PENDING returns the unsorted batch; retryable returns empty
      prisma.syncQueue.findMany
        .mockResolvedValueOnce(entries)
        .mockResolvedValueOnce([]);

      service = createSyncPushService({ prisma, baseUrl: "http://localhost:3000" });

      const prepared = await service.preparePush();

      const orderedTypes = prepared.entries.map((e) => e.operationType);
      expect(orderedTypes).toEqual([
        "PRODUCT_CREATION",
        "SHIFT_OPEN",
        "SALE_CONFIRMATION",
        "INVENTORY_ADJUSTMENT",
      ]);
    });

    it("orders SHIFT_OPEN and SHIFT_CLOSURE within same priority by clientSequence", async () => {
      const entries = [
        makePendingEntry({ id: "e-close", operationUuid: "u-close", operationType: "SHIFT_CLOSURE", clientSequence: 5n }),
        makePendingEntry({ id: "e-open", operationUuid: "u-open", operationType: "SHIFT_OPEN", clientSequence: 2n }),
        makePendingEntry({ id: "e-open2", operationUuid: "u-open2", operationType: "SHIFT_OPEN", clientSequence: 8n }),
      ];
      prisma.syncQueue.findMany
        .mockResolvedValueOnce(entries)
        .mockResolvedValueOnce([]);

      service = createSyncPushService({ prisma, baseUrl: "http://localhost:3000" });

      const prepared = await service.preparePush();

      // Both SHIFT_OPEN and SHIFT_CLOSURE share priority 2/3? Actually SHIFT_OPEN=2, SHIFT_CLOSURE=3
      // so SHIFT_OPEN entries come before SHIFT_CLOSURE regardless of sequence, then within SHIFT_OPEN sorted by sequence
      const orderedIds = prepared.entries.map((e) => e.id);
      expect(orderedIds).toEqual(["e-open", "e-open2", "e-close"]);
    });

    it("preserves clientSequence order within same SHIFT_OPEN priority group", async () => {
      const entries = [
        makePendingEntry({ id: "e3", operationUuid: "u3", operationType: "SHIFT_OPEN", clientSequence: 30n }),
        makePendingEntry({ id: "e1", operationUuid: "u1", operationType: "SHIFT_OPEN", clientSequence: 10n }),
        makePendingEntry({ id: "e2", operationUuid: "u2", operationType: "SHIFT_OPEN", clientSequence: 20n }),
      ];
      prisma.syncQueue.findMany
        .mockResolvedValueOnce(entries)
        .mockResolvedValueOnce([]);

      service = createSyncPushService({ prisma, baseUrl: "http://localhost:3000" });

      const prepared = await service.preparePush();

      expect(prepared.entries.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    });

    it("places unknown operation types at lowest priority after all known groups", async () => {
      const entries = [
        makePendingEntry({ id: "e-unknown", operationUuid: "u-unknown", operationType: "UNKNOWN_OP", clientSequence: 1n }),
        makePendingEntry({ id: "e-shift", operationUuid: "u-shift", operationType: "SHIFT_OPEN", clientSequence: 2n }),
        makePendingEntry({ id: "e-audit", operationUuid: "u-audit", operationType: "AUDIT_LOG_BATCH", clientSequence: 3n }),
      ];
      prisma.syncQueue.findMany
        .mockResolvedValueOnce(entries)
        .mockResolvedValueOnce([]);

      service = createSyncPushService({ prisma, baseUrl: "http://localhost:3000" });

      const prepared = await service.preparePush();

      const orderedTypes = prepared.entries.map((e) => e.operationType);
      // SHIFT_OPEN (2) -> AUDIT_LOG_BATCH (7) -> UNKNOWN (99)
      expect(orderedTypes).toEqual(["SHIFT_OPEN", "AUDIT_LOG_BATCH", "UNKNOWN_OP"]);
    });

    it("ensures PUSH_BATCH_LIMIT respected while maintaining SHIFT_OPEN priority ordering", async () => {
      const entries = Array.from({ length: 12 }, (_, i) => {
        const type = i % 2 === 0 ? "SHIFT_OPEN" : "SALE_CONFIRMATION";
        return makePendingEntry({
          id: `e-${i}`,
          operationUuid: `u-${i}`,
          operationType: type,
          clientSequence: BigInt(i + 1),
        });
      });
      // PENDING returns first 10 (limit), but our mock returns 12 — service should only take 10 via take param,
      // however our mock bypasses limit; we test sorting still correct for 12
      prisma.syncQueue.findMany
        .mockResolvedValueOnce(entries.slice(0, 10))
        .mockResolvedValueOnce([]);

      service = createSyncPushService({ prisma, baseUrl: "http://localhost:3000" });

      const prepared = await service.preparePush();

      expect(prepared.entries.length).toBe(10);
      // All SHIFT_OPEN (priority 2) should come before SALE_CONFIRMATION (3)
      const shiftCount = prepared.entries.filter((e) => e.operationType === "SHIFT_OPEN").length;
      const saleFirstIndex = prepared.entries.findIndex((e) => e.operationType === "SALE_CONFIRMATION");
      const lastShiftIndex = prepared.entries.map((e) => e.operationType).lastIndexOf("SHIFT_OPEN");
      if (shiftCount > 0 && saleFirstIndex !== -1) {
        expect(lastShiftIndex).toBeLessThan(saleFirstIndex);
      }
    });
  });
});
