/**
 * Unit tests for ClientPullService — pulling clients from the server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createClientPullService, type ClientPullService, ClientPullHttpError } from "./client-pull.service";
import type { SyncHttpClient } from "../catalog/catalog-sync.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
const tx: any = {
$executeRawUnsafe: vi.fn().mockResolvedValue(0),
client: {
upsert: vi.fn().mockResolvedValue({}),
},
clientClassification: {
findMany: vi.fn().mockResolvedValue([]),
},
};

  const prisma = {
    $transaction: vi.fn(async (cb: (t: any) => unknown) => cb(tx)),
    client: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    clientClassification: tx.clientClassification,
  } as any;

  return { prisma, tx };
};

const makeMockHttpClient = (): SyncHttpClient => ({
  get: vi.fn(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ClientPullService", () => {
  let prisma: any;
  let tx: any;
  let http: SyncHttpClient;
  let service: ClientPullService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    http = makeMockHttpClient();
    service = createClientPullService(prisma, {
      baseUrl: "http://localhost:3000",
      httpClient: http,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const makeClientRow = (overrides: Record<string, unknown> = {}) => ({
    id: "client-1",
    fullName: "Juan Pérez",
    identificationType: "CC",
    identificationNumber: "12345678",
    email: "juan@example.com",
    phone: "3001234567",
    address: "Calle 123",
    municipality: "Bogotá",
    department: "Cundinamarca",
    isActive: true,
    classificationId: null,
    createdById: "user-1",
    updatedById: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-07-10T00:00:00Z",
    consentGivenAt: null,
    consentVersion: null,
    consentScope: null,
    dataSubjectRequestStatus: "NONE",
    dataSubjectRequestAt: null,
    ...overrides,
  });

  describe("pullClients", () => {
    it("fetches clients and upserts them with a single batch SQL statement", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get).mockResolvedValue({
        data: [makeClientRow()],
        total: 1,
        page: 1,
        pageSize: 200,
      });

      await service.pullClients();

// The upsert is a typed Prisma write, one per row, rather than a batch INSERT:
// the Tauri WebView has no SharedArrayBuffer, so PGlite cannot prepare a
// $executeRawUnsafe statement there even though it works in Node.
expect(tx.client.upsert).toHaveBeenCalledTimes(1);
const arg = tx.client.upsert.mock.calls[0][0];
expect(arg.where).toEqual({
identificationType_identificationNumber: {
identificationType: "CC",
identificationNumber: "12345678",
},
});
expect(arg.create).toEqual(expect.objectContaining({ fullName: "Juan Pérez" }));
// Identity fields must survive a conflict: an existing local row keeps its id.
expect(arg.update.id).toBeUndefined();
expect(arg.update.createdAt).toBeUndefined();
expect(arg.update.createdById).toBeUndefined();

vi.unstubAllGlobals();
});

    it("batches large pulls into multiple chunked upsert statements", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      const total = 1200;
      const pageSize = 200;
      const pageCount = Math.ceil(total / pageSize);
      for (let page = 1; page <= pageCount; page++) {
        const start = (page - 1) * pageSize;
        const data = Array.from({ length: pageSize }, (_, i) =>
          makeClientRow({
            id: `client-${start + i}`,
            identificationNumber: String(10000000 + start + i),
          }),
        );
        vi.mocked(http.get).mockResolvedValueOnce({
          data,
          total,
          page,
          pageSize,
        });
      }

await service.pullClients();

// 1200 rows across 500-row chunks (500 + 500 + 200), all written inside the
// pull's single transaction. The chunking exists to keep each statement under
// the parameter limit, so what matters is that no row is dropped.
expect(tx.client.upsert).toHaveBeenCalledTimes(1200);
const written = tx.client.upsert.mock.calls.map(([arg]: any[]) => arg.create.id);
expect(new Set(written).size).toBe(1200);
expect(written).toContain("client-0");
expect(written).toContain("client-1199");

vi.unstubAllGlobals();
});

    it("nulls classificationId when the classification is unknown locally", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      tx.clientClassification.findMany.mockResolvedValue([{ id: "cls-known" }]);

      vi.mocked(http.get).mockResolvedValue({
        data: [
          makeClientRow({
            id: "client-known",
            identificationNumber: "11111111",
            classificationId: "cls-known",
          }),
          makeClientRow({
            id: "client-unknown",
            identificationNumber: "22222222",
            classificationId: "cls-missing",
          }),
        ],
        total: 2,
        page: 1,
        pageSize: 200,
      });

await service.pullClients();

const written = tx.client.upsert.mock.calls.map(([arg]: any[]) => arg.create.classificationId);
expect(written).toContain("cls-known");
expect(written).not.toContain("cls-missing");

vi.unstubAllGlobals();
});

    it("does nothing when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });

      await service.pullClients();

      expect(http.get).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("throws ClientPullHttpError on HTTP error", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get).mockRejectedValue(
        new ClientPullHttpError("/clients/sync", 500, "Server error"),
      );

      await expect(service.pullClients()).rejects.toThrow(ClientPullHttpError);

      vi.unstubAllGlobals();
    });

    it("updates the sync timestamp even when no clients are returned", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get).mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 200,
      });

      await service.pullClients();

      // No writes should have happened
      expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});
