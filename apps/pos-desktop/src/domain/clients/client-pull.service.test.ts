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
    client: { upsert: vi.fn() },
  };

  const prisma = {
    $transaction: vi.fn(async (cb: (t: any) => unknown) => cb(tx)),
    client: tx.client,
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

  describe("pullClients", () => {
    it("fetches clients and upserts them locally", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get).mockResolvedValue({
        data: [{
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
        }],
        total: 1,
        page: 1,
        pageSize: 200,
      });

      await service.pullClients();

      expect(tx.client.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "client-1" },
          create: expect.objectContaining({
            fullName: "Juan Pérez",
            identificationNumber: "12345678",
          }),
        }),
      );

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

      // No upserts should have happened
      expect(tx.client.upsert).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});
