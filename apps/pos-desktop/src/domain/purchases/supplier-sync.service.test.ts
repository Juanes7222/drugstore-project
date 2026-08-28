/**
 * Unit tests for SupplierSyncService — pulling suppliers from server.
 *
 * Pattern mirrors CatalogSyncService / LotSyncService / ClientPullService.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@pharmacy/database/local";
import {
  createSupplierSyncService,
  SupplierSyncService,
  SupplierSyncHttpError,
} from "./supplier-sync.service";
import type { SyncHttpClient } from "../catalog/catalog-sync.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    supplier: { upsert: vi.fn() },
  };

  const prisma = {
    $transaction: vi.fn(async (cb: (tx: any) => unknown) => cb(tx)),
    supplier: tx.supplier,
  } as any;

  return { prisma, tx };
};

const makeMockHttpClient = (): SyncHttpClient => ({
  get: vi.fn(),
});

const makeSupplierRow = (overrides: Record<string, unknown> = {}) => ({
  id: "supplier-1",
  identificationType: "NIT",
  identificationNumber: "900123456-7",
  businessName: "Distribuidora Farmaceutica SAS",
  contactName: "Carlos Lopez",
  phone: "+57 321 456 7890",
  email: "carlos@distribuidora.com",
  address: "Calle 45 # 23-12",
  city: "Bogota",
  country: "CO",
  paymentTermsDays: 30,
  creditLimit: "5000000",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-07-10T00:00:00Z",
  createdById: "user-1",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("SupplierSyncService", () => {
  let prisma: any;
  let tx: any;
  let http: SyncHttpClient;
  let service: SupplierSyncService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    http = makeMockHttpClient();
    service = createSupplierSyncService(prisma, {
      baseUrl: "http://localhost:3000",
      httpClient: http,
    });
    localStorage.clear();
    vi.stubGlobal("navigator", { onLine: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  describe("factory", () => {
    it("creates an instance via createSupplierSyncService", () => {
      const instance = createSupplierSyncService(prisma, {
        baseUrl: "http://localhost:3000/",
        httpClient: http,
      });

      expect(instance).toBeInstanceOf(SupplierSyncService);
    });

    it("trims trailing slashes from baseUrl", async () => {
      const svc = createSupplierSyncService(prisma, {
        baseUrl: "http://localhost:3000///",
        httpClient: http,
      });

      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });

      await svc.fetchSuppliers();

      const calledUrl = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(calledUrl).not.toContain("///purchases");
      expect(calledUrl).toContain("http://localhost:3000/purchases/suppliers/sync");
    });
  });

  describe("pullSuppliers — isOnline guard", () => {
    it("does nothing when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });

      await service.pullSuppliers();

      expect(http.get).not.toHaveBeenCalled();
      expect(tx.supplier.upsert).not.toHaveBeenCalled();
    });

    it("fetches and applies when online", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makeSupplierRow()], nextCursor: null, hasMore: false });

      await service.pullSuppliers();

      expect(tx.supplier.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchSuppliers — cursor pagination", () => {
    it("fetches single page when hasMore is false", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makeSupplierRow()], nextCursor: null, hasMore: false });

      const rows = await service.fetchSuppliers();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("supplier-1");
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it("paginates through multiple cursor pages", async () => {
      vi.mocked(http.get)
        .mockResolvedValueOnce({ data: [makeSupplierRow({ id: "sup-1" })], nextCursor: "cur-1", hasMore: true })
        .mockResolvedValueOnce({ data: [makeSupplierRow({ id: "sup-2" })], nextCursor: null, hasMore: false });

      const rows = await service.fetchSuppliers();

      expect(rows).toHaveLength(2);
      expect(rows[0].id).toBe("sup-1");
      expect(rows[1].id).toBe("sup-2");
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it("handles catalog-shape compatibility: reads items when data is missing", async () => {
      vi.mocked(http.get).mockResolvedValue({ items: [makeSupplierRow({ id: "sup-1" })], nextCursor: null, hasMore: false } as any);

      const rows = await service.fetchSuppliers();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("sup-1");
    });

    it("sends updatedSince cursor param when sync-metadata has a timestamp", async () => {
      // Seed timestamp via real localStorage path (installId = uninitialized)
      const { setSuppliersLastSyncedAt } = await import("../../common/sync-metadata");
      setSuppliersLastSyncedAt("2026-07-09T00:00:00.000Z");

      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });

      await service.fetchSuppliers();

      const url = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(url).toContain("updatedSince=");
      expect(url).toContain(encodeURIComponent("2026-07-09T00:00:00.000Z"));
    });

    it("sends Authorization header when accessToken is configured", async () => {
      const authed = createSupplierSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        accessToken: "tok-123",
      });

      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });

      await authed.fetchSuppliers();

      const headers = vi.mocked(http.get).mock.calls[0][1] as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok-123");
    });

    it("falls back to legacy offset pagination when cursor endpoint throws", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor not found"))
        .mockResolvedValueOnce({ data: [makeSupplierRow({ id: "legacy-1" })], total: 1, page: 1, pageSize: 200 });

      const rows = await service.fetchSuppliers();

      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe("legacy-1");
      // First call was cursor endpoint, second was legacy page 1
      expect(http.get).toHaveBeenCalledTimes(2);
      expect(vi.mocked(http.get).mock.calls[1][0]).toContain("/purchases/suppliers?page=1");
    });

    it("legacy fallback paginates across multiple pages", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor unsupported"))
        .mockResolvedValueOnce({ data: [makeSupplierRow({ id: "s-1" })], total: 3, page: 1, pageSize: 2 } as any)
        .mockResolvedValueOnce({ data: [makeSupplierRow({ id: "s-2" })], total: 3, page: 2, pageSize: 2 } as any)
        .mockResolvedValueOnce({ data: [makeSupplierRow({ id: "s-3" })], total: 3, page: 3, pageSize: 2 } as any);

      // Need to override pageSize used by service (200) -> but total/pageSize math still works
      // Mock to givetotal= 400 page 1 pageSize 200 would be 2 pages; simpler: just mock total math via service's ceil
      // Instead test with default 200: total 400 => 2 pages
      vi.mocked(http.get).mockReset();
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor unsupported"))
        .mockResolvedValueOnce({ data: [makeSupplierRow({ id: "s-1" })], total: 400, page: 1, pageSize: 200 })
        .mockResolvedValueOnce({ data: [makeSupplierRow({ id: "s-2" })], total: 400, page: 2, pageSize: 200 });

      const rows = await service.fetchSuppliers();

      expect(rows).toHaveLength(2);
      expect(http.get).toHaveBeenCalledTimes(3);
    });
  });

  describe("applySuppliers", () => {
    it("upserts each supplier row and records syncedAt", async () => {
      const row = makeSupplierRow();

      await service.applySuppliers([row as any]);

      expect(tx.supplier.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "supplier-1" },
          create: expect.objectContaining({
            id: "supplier-1",
            businessName: "Distribuidora Farmaceutica SAS",
            identificationNumber: "900123456-7",
            country: "CO",
          }),
          update: expect.objectContaining({
            businessName: "Distribuidora Farmaceutica SAS",
          }),
        }),
      );

      const { getSuppliersLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getSuppliersLastSyncedAt()).not.toBeNull();
    });

    it("maps creditLimit to Prisma.Decimal and defaults country to CO", async () => {
      const row = makeSupplierRow({ creditLimit: "123.45", country: undefined });

      await service.applySuppliers([row as any]);

      expect(tx.supplier.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            creditLimit: new Prisma.Decimal("123.45"),
            country: "CO",
          }),
        }),
      );
    });

    it("still records syncedAt when rows array is empty", async () => {
      await service.applySuppliers([]);

      expect(tx.supplier.upsert).not.toHaveBeenCalled();

      const { getSuppliersLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getSuppliersLastSyncedAt()).not.toBeNull();
    });

    it("wraps upserts in a single $transaction", async () => {
      await service.applySuppliers([makeSupplierRow() as any, makeSupplierRow({ id: "sup-2", identificationNumber: "999" }) as any]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.supplier.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("fetchSuppliers + applySuppliers integration via pullSuppliers", () => {
    it("propagates HTTP error when fetch fails and fallback also fails", async () => {
      vi.mocked(http.get).mockRejectedValue(new Error("network down"));

      // fetchAll tries cursor, catches, then fetchLegacy which also rejects
      // fetchLegacy's http.get also rejects => pullSuppliers should reject
      await expect(service.pullSuppliers()).rejects.toThrow();
    });
  });

  describe("SupplierSyncHttpError", () => {
    it("carries statusCode and responseBody", () => {
      const err = new SupplierSyncHttpError("http://x", 500, "boom");

      expect(err.statusCode).toBe(500);
      expect(err.responseBody).toBe("boom");
      expect(err.name).toBe("SupplierSyncHttpError");
    });
  });
});
