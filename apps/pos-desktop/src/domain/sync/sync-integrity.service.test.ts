/**
 * Unit tests for the sync ledger integrity service.
 *
 * Covers local-status → wire-status mapping, ledger collection (incl.
 * sale localNumber extraction), request chunking, verdict aggregation,
 * and failure propagation.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  collectSyncIntegrityOperations,
  createSyncIntegrityClient,
  mapLocalStatusToWireStatus,
  runSyncIntegrityVerification,
  SYNC_INTEGRITY_CHUNK_SIZE,
} from "./sync-integrity.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPostWithAuth = vi.fn();

vi.mock("../auth/auth-http-client", () => ({
  createAuthHttpClient: vi.fn(() => ({
    postWithAuth: mockPostWithAuth,
  })),
}));

const makeMockPrisma = (rows: Array<Record<string, unknown>>) => ({
  syncQueue: {
    findMany: vi.fn().mockResolvedValue(rows),
  },
}) as unknown as import("@pharmacy/database/local").PrismaClient;

const saleRow = (
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> => ({
  operationUuid: "sale-uuid-1",
  status: "PENDING",
  operationType: "SALE_CONFIRMATION",
  payload: JSON.stringify({ metadata: { localSaleId: "sale-1", localNumber: 7 } }),
  clientSequence: 1n,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

describe("mapLocalStatusToWireStatus", () => {
  it("maps COMPLETED to SYNCED", () => {
    expect(mapLocalStatusToWireStatus("COMPLETED")).toBe("SYNCED");
  });

  it("maps FAILED and PERMANENT_FAILURE to FAILED", () => {
    expect(mapLocalStatusToWireStatus("FAILED")).toBe("FAILED");
    expect(mapLocalStatusToWireStatus("PERMANENT_FAILURE")).toBe("FAILED");
  });

  it("maps DISCARDED to DISCARDED so historical rows are still reported", () => {
    expect(mapLocalStatusToWireStatus("DISCARDED")).toBe("DISCARDED");
  });

  it("maps PENDING and PROCESSING to PENDING", () => {
    expect(mapLocalStatusToWireStatus("PENDING")).toBe("PENDING");
    expect(mapLocalStatusToWireStatus("PROCESSING")).toBe("PENDING");
  });

  it("falls back to PENDING for unknown statuses", () => {
    expect(mapLocalStatusToWireStatus("SOMETHING_NEW")).toBe("PENDING");
  });
});

// ---------------------------------------------------------------------------
// Ledger collection
// ---------------------------------------------------------------------------

describe("collectSyncIntegrityOperations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("collects every entry regardless of status, including DISCARDED rows", async () => {
    const prisma = makeMockPrisma([
      saleRow({ operationUuid: "a", status: "COMPLETED" }),
      saleRow({ operationUuid: "b", status: "DISCARDED" }),
      saleRow({ operationUuid: "c", status: "PERMANENT_FAILURE" }),
    ]);

    const { operations } = await collectSyncIntegrityOperations(prisma);

    expect(operations).toHaveLength(3);
    expect(operations.map((o) => o.operationUuid)).toEqual(["a", "b", "c"]);
    expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          operationUuid: true,
          status: true,
          operationType: true,
          payload: true,
        }),
        orderBy: { clientSequence: "asc" },
      }),
    );
  });

  it("attaches localNumber only for SALE_CONFIRMATION payloads carrying one", async () => {
    const prisma = makeMockPrisma([
      saleRow(),
      saleRow({
        operationUuid: "return-1",
        operationType: "CLIENT_RETURN",
        payload: JSON.stringify({ sequentialNumber: 3 }),
      }),
      saleRow({
        operationUuid: "sale-broken",
        payload: "{not json",
      }),
    ]);

    const { operations } = await collectSyncIntegrityOperations(prisma);

    expect(operations[0]).toEqual({
      operationUuid: "sale-uuid-1",
      status: "PENDING",
      localNumber: 7,
    });
    expect(operations[1]).toEqual({
      operationUuid: "return-1",
      status: "PENDING",
    });
    expect(operations[2]).toEqual({
      operationUuid: "sale-broken",
      status: "PENDING",
    });
    expect("localNumber" in operations[1]).toBe(false);
    expect("localNumber" in operations[2]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Verification orchestration
// ---------------------------------------------------------------------------

describe("runSyncIntegrityVerification", () => {
  const baseConfig = {
    baseUrl: "http://localhost:3000/api/v1",
    accessToken: "token-1",
    workstationId: "ws-1",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("short-circuits with zero counts and no network call when the queue is empty", async () => {
    const prisma = makeMockPrisma([]);

    const outcome = await runSyncIntegrityVerification({ ...baseConfig, prisma });

    expect(outcome).toEqual({
      operationCount: 0,
      flaggedCount: 0,
      byVerdict: { OK: 0, NOT_SUBMITTED: 0, NOT_ACCEPTED: 0, STATUS_MISMATCH: 0 },
      checkedAt: null,
    });
    expect(mockPostWithAuth).not.toHaveBeenCalled();
  });

  it("POSTs to /sync/integrity/verify with the workstation id and operations", async () => {
    mockPostWithAuth.mockResolvedValue({
      checkedAt: "2026-08-24T10:00:00.000Z",
      results: [
        { operationUuid: "sale-uuid-1", verdict: "OK", clientStatus: "SYNCED", serverStatus: "SYNCED" },
      ],
      summary: { OK: 1, NOT_SUBMITTED: 0, NOT_ACCEPTED: 0, STATUS_MISMATCH: 0 },
    });
    const prisma = makeMockPrisma([saleRow()]);

    const outcome = await runSyncIntegrityVerification({ ...baseConfig, prisma });

    expect(mockPostWithAuth).toHaveBeenCalledTimes(1);
    expect(mockPostWithAuth).toHaveBeenCalledWith(
      "/sync/integrity/verify",
      {
        workstationId: "ws-1",
        operations: [
          { operationUuid: "sale-uuid-1", status: "PENDING", localNumber: 7 },
        ],
      },
      "token-1",
    );
    expect(outcome.flaggedCount).toBe(0);
    expect(outcome.byVerdict.OK).toBe(1);
    expect(outcome.checkedAt).toBe("2026-08-24T10:00:00.000Z");
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("chunks large ledgers into sequential requests of at most 1000 operations", async () => {
    expect(SYNC_INTEGRITY_CHUNK_SIZE).toBe(1000);

    mockPostWithAuth.mockResolvedValue({
      checkedAt: "2026-08-24T10:00:00.000Z",
      results: [],
      summary: { OK: 0, NOT_SUBMITTED: 0, NOT_ACCEPTED: 0, STATUS_MISMATCH: 0 },
    });
    const rows = Array.from({ length: 2500 }, (_, i) =>
      saleRow({
        operationUuid: `uuid-${i}`,
        clientSequence: BigInt(i),
        status: i % 2 === 0 ? "COMPLETED" : "FAILED",
      }),
    );
    const prisma = makeMockPrisma(rows);

    const outcome = await runSyncIntegrityVerification({ ...baseConfig, prisma });

    expect(mockPostWithAuth).toHaveBeenCalledTimes(3);
    const calls = mockPostWithAuth.mock.calls;
    expect(calls[0][1].operations).toHaveLength(SYNC_INTEGRITY_CHUNK_SIZE);
    expect(calls[1][1].operations).toHaveLength(SYNC_INTEGRITY_CHUNK_SIZE);
    expect(calls[2][1].operations).toHaveLength(500);
    // Sequential chunks preserve order and carry the workstation id each time.
    expect(calls[0][1].operations[0].operationUuid).toBe("uuid-0");
    expect(calls[2][1].operations[499].operationUuid).toBe("uuid-2499");
    for (const call of calls) {
      expect(call[1].workstationId).toBe("ws-1");
    }
    expect(outcome.operationCount).toBe(2500);
  });

  it("aggregates non-OK verdicts across chunks, counts them as flagged and warns per row", async () => {
    mockPostWithAuth
      .mockResolvedValueOnce({
        checkedAt: "2026-08-24T10:00:00.000Z",
        results: [
          { operationUuid: "u1", verdict: "NOT_SUBMITTED", clientStatus: "DISCARDED", serverStatus: null },
          { operationUuid: "u2", verdict: "OK", clientStatus: "SYNCED", serverStatus: "SYNCED" },
        ],
        summary: { OK: 1, NOT_SUBMITTED: 1, NOT_ACCEPTED: 0, STATUS_MISMATCH: 0 },
      })
      .mockResolvedValueOnce({
        checkedAt: "2026-08-24T10:01:00.000Z",
        results: [
          { operationUuid: "u3", verdict: "STATUS_MISMATCH", clientStatus: "SYNCED", serverStatus: "PENDING" },
          { operationUuid: "u4", verdict: "NOT_ACCEPTED", clientStatus: "FAILED", serverStatus: null },
        ],
        summary: { OK: 0, NOT_SUBMITTED: 0, NOT_ACCEPTED: 1, STATUS_MISMATCH: 1 },
      });

    const rows = Array.from({ length: 1002 }, (_, i) =>
      saleRow({ operationUuid: `u${i + 1}`, clientSequence: BigInt(i) }),
    );
    const prisma = makeMockPrisma(rows);

    const outcome = await runSyncIntegrityVerification({ ...baseConfig, prisma });

    expect(outcome.flaggedCount).toBe(3);
    expect(outcome.byVerdict).toEqual({
      OK: 1,
      NOT_SUBMITTED: 1,
      NOT_ACCEPTED: 1,
      STATUS_MISMATCH: 1,
    });
    // Last chunk's checkedAt wins.
    expect(outcome.checkedAt).toBe("2026-08-24T10:01:00.000Z");
    expect(console.warn).toHaveBeenCalledTimes(3);
  });

  it("propagates transport errors from the HTTP client", async () => {
    mockPostWithAuth.mockRejectedValue(new Error("[401] Unauthorized"));
    const prisma = makeMockPrisma([saleRow()]);

    await expect(
      runSyncIntegrityVerification({ ...baseConfig, prisma }),
    ).rejects.toThrow("[401] Unauthorized");
  });
});

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

describe("createSyncIntegrityClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to postWithAuth on the auth http client", async () => {
    mockPostWithAuth.mockResolvedValue({
      checkedAt: "2026-08-24T10:00:00.000Z",
      results: [],
      summary: { OK: 0, NOT_SUBMITTED: 0, NOT_ACCEPTED: 0, STATUS_MISMATCH: 0 },
    });

    const client = createSyncIntegrityClient({ baseUrl: "http://localhost:3000/api/v1/" });
    const response = await client.verifyIntegrity(
      { workstationId: "ws-1", operations: [] },
      "token-2",
    );

    expect(mockPostWithAuth).toHaveBeenCalledWith(
      "/sync/integrity/verify",
      { workstationId: "ws-1", operations: [] },
      "token-2",
    );
    expect(response.checkedAt).toBe("2026-08-24T10:00:00.000Z");
  });
});
