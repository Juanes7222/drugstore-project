/**
 * Unit tests for LotSyncService — pulling lots from the server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createLotSyncService, type LotSyncService, LotSyncHttpError } from "./lot-sync.service";
import type { SyncHttpClient } from "../catalog/catalog-sync.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    lot: { upsert: vi.fn() },
  };

  const prisma = {
    $transaction: vi.fn(async (cb: (t: any) => unknown) => cb(tx)),
    lot: tx.lot,
  } as any;

  return { prisma, tx };
};

const makeMockHttpClient = (): SyncHttpClient => ({
  get: vi.fn(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LotSyncService", () => {
  let prisma: any;
  let tx: any;
  let http: SyncHttpClient;
  let service: LotSyncService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    http = makeMockHttpClient();
    service = createLotSyncService(prisma, {
      baseUrl: "http://localhost:3000",
      httpClient: http,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("pullLots", () => {
    it("fetches paginated lots and upserts them locally", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get).mockResolvedValue({
        data: [{
          id: "lot-1",
          batchNumber: "B001",
          expirationDate: "2026-12-31T00:00:00Z",
          entryDate: "2026-01-15T00:00:00Z",
          state: "ACTIVE",
          currentStock: 100,
          version: 1,
          productId: "prod-1",
          locationCode: "A-1",
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-07-10T00:00:00Z",
          blockedAt: null,
          blockedByUserId: null,
          blockReason: null,
        }],
        total: 1,
        page: 1,
        pageSize: 500,
      });

      await service.pullLots();

      expect(tx.lot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "lot-1" },
          create: expect.objectContaining({
            batchNumber: "B001",
            currentStock: 100,
          }),
          update: expect.objectContaining({
            batchNumber: "B001",
            currentStock: 100,
          }),
        }),
      );

      vi.unstubAllGlobals();
    });

    it("does nothing when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });

      await service.pullLots();

      expect(http.get).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("throws LotSyncHttpError on HTTP error", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get).mockRejectedValue(
        new LotSyncHttpError("/inventory-lots/lots", 500, "Server error"),
      );

      await expect(service.pullLots()).rejects.toThrow(LotSyncHttpError);

      vi.unstubAllGlobals();
    });
  });
});
