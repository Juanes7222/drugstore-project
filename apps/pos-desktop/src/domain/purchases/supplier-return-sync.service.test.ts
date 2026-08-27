/**
 * Unit tests for SupplierReturnSyncService — pulling supplier returns from server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@pharmacy/database/local";
import {
  createSupplierReturnSyncService,
  SupplierReturnSyncService,
  SupplierReturnSyncHttpError,
} from "./supplier-return-sync.service";
import type { SyncHttpClient } from "../catalog/catalog-sync.service";

const makeMockPrisma = () => {
  const tx: any = {
    supplierReturn: { upsert: vi.fn() },
    supplierReturnItem: { upsert: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: any) => unknown) => cb(tx)),
    supplierReturn: tx.supplierReturn,
    supplierReturnItem: tx.supplierReturnItem,
  } as any;
  return { prisma, tx };
};

const makeMockHttpClient = (): SyncHttpClient => ({ get: vi.fn() });

const makeReturnRow = (overrides: Record<string, unknown> = {}) => ({
  id: "return-1",
  sequentialNumber: 1,
  state: "CONFIRMED",
  supplierId: "supplier-1",
  purchaseReceptionId: "reception-1",
  reason: "Damaged goods",
  notes: "Boxes dented",
  subtotal: "50000",
  totalTax: "9500",
  totalAmount: "59500",
  createdAt: "2026-07-18T00:00:00Z",
  createdById: "user-1",
  updatedAt: "2026-07-18T12:00:00Z",
  items: [
    {
      id: "ret-item-1",
      productId: "prod-1",
      lotId: "lot-1",
      quantity: 5,
      unitCost: "10000",
      totalAmount: "50000",
    },
  ],
  ...overrides,
});

describe("SupplierReturnSyncService", () => {
  let prisma: any;
  let tx: any;
  let http: SyncHttpClient;
  let service: SupplierReturnSyncService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    http = makeMockHttpClient();
    service = createSupplierReturnSyncService(prisma, {
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

  describe("factory and config", () => {
    it("creates instance via createSupplierReturnSyncService", () => {
      const instance = createSupplierReturnSyncService(prisma, {
        baseUrl: "http://localhost:3000/",
        httpClient: http,
      });
      expect(instance).toBeInstanceOf(SupplierReturnSyncService);
    });

    it("trims trailing slashes from baseUrl", async () => {
      const svc = createSupplierReturnSyncService(prisma, {
        baseUrl: "http://localhost:3000///",
        httpClient: http,
      });
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await svc.fetchSupplierReturns();
      const url = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(url).toContain("http://localhost:3000/purchases/supplier-returns/sync");
    });
  });

  describe("pullSupplierReturns — isOnline guard", () => {
    it("does nothing when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      await service.pullSupplierReturns();
      expect(http.get).not.toHaveBeenCalled();
      expect(tx.supplierReturn.upsert).not.toHaveBeenCalled();
    });

    it("fetches and applies when online", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makeReturnRow()], nextCursor: null, hasMore: false });
      await service.pullSupplierReturns();
      expect(tx.supplierReturn.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchSupplierReturns — cursor pagination", () => {
    it("fetches single page when hasMore is false", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makeReturnRow()], nextCursor: null, hasMore: false });
      const rows = await service.fetchSupplierReturns();
      expect(rows).toHaveLength(1);
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it("paginates through multiple cursor pages", async () => {
      vi.mocked(http.get)
        .mockResolvedValueOnce({ data: [makeReturnRow({ id: "ret-1" })], nextCursor: "cur-1", hasMore: true })
        .mockResolvedValueOnce({ data: [makeReturnRow({ id: "ret-2" })], nextCursor: null, hasMore: false });
      const rows = await service.fetchSupplierReturns();
      expect(rows).toHaveLength(2);
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it("sends updatedSince when metadata has a timestamp", async () => {
      const { setSupplierReturnsLastSyncedAt } = await import("../../common/sync-metadata");
      setSupplierReturnsLastSyncedAt("2026-07-09T12:00:00.000Z");
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await service.fetchSupplierReturns();
      const url = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(url).toContain("updatedSince=");
    });

    it("sends Authorization header when accessToken is configured", async () => {
      const authed = createSupplierReturnSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        accessToken: "tok-123",
      });
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await authed.fetchSupplierReturns();
      const headers = vi.mocked(http.get).mock.calls[0][1] as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok-123");
    });

    it("falls back to legacy offset pagination when cursor endpoint throws", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor not found"))
        .mockResolvedValueOnce({ data: [makeReturnRow()], total: 1, page: 1, pageSize: 200 });
      const rows = await service.fetchSupplierReturns();
      expect(rows).toHaveLength(1);
      expect(http.get).toHaveBeenCalledTimes(2);
      expect(vi.mocked(http.get).mock.calls[1][0]).toContain("/purchases/supplier-returns?page=1");
    });

    it("legacy fallback paginates across multiple pages", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor unsupported"))
        .mockResolvedValueOnce({ data: [makeReturnRow({ id: "ret-1" })], total: 400, page: 1, pageSize: 200 })
        .mockResolvedValueOnce({ data: [makeReturnRow({ id: "ret-2" })], total: 400, page: 2, pageSize: 200 });
      const rows = await service.fetchSupplierReturns();
      expect(rows).toHaveLength(2);
      expect(http.get).toHaveBeenCalledTimes(3);
    });
  });

  describe("applySupplierReturns", () => {
    it("upserts supplier return and items, records syncedAt", async () => {
      const row = makeReturnRow();

      await service.applySupplierReturns([row as any]);

      expect(tx.supplierReturn.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "return-1" },
          create: expect.objectContaining({
            id: "return-1",
            sequentialNumber: 1,
            supplierId: "supplier-1",
          }),
        }),
      );

      const { getSupplierReturnsLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getSupplierReturnsLastSyncedAt()).not.toBeNull();
    });

    it("maps monetary fields to Prisma.Decimal and dates to Date", async () => {
      const row = makeReturnRow({ subtotal: "123.45", totalTax: "19.00", totalAmount: "142.45" });

      await service.applySupplierReturns([row as any]);

      expect(tx.supplierReturn.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            subtotal: new Prisma.Decimal("123.45"),
            totalTax: new Prisma.Decimal("19.00"),
            totalAmount: new Prisma.Decimal("142.45"),
          }),
        }),
      );
    });

    it("handles null purchaseReceptionId", async () => {
      const row = makeReturnRow({ purchaseReceptionId: null });

      await service.applySupplierReturns([row as any]);

      expect(tx.supplierReturn.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            purchaseReceptionId: null,
          }),
        }),
      );
    });

    it("deletes orphan items not in payload then upserts each item", async () => {
      const row = makeReturnRow({
        items: [
          { id: "ret-item-1", productId: "prod-1", lotId: "lot-1", quantity: 2, unitCost: "10000", totalAmount: "20000" },
          { id: "ret-item-2", productId: "prod-2", lotId: "lot-2", quantity: 1, unitCost: "5000", totalAmount: "5000" },
        ],
      });

      await service.applySupplierReturns([row as any]);

      expect(tx.supplierReturnItem.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { supplierReturnId: "return-1", id: { notIn: expect.arrayContaining(["ret-item-1", "ret-item-2"]) } },
        }),
      );
      expect(tx.supplierReturnItem.upsert).toHaveBeenCalledTimes(2);
      expect(tx.supplierReturnItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "ret-item-1" },
          create: expect.objectContaining({
            productId: "prod-1",
            quantity: 2,
            unitCost: new Prisma.Decimal("10000"),
            totalAmount: new Prisma.Decimal("20000"),
          }),
        }),
      );
    });

    it("still records syncedAt when rows array is empty", async () => {
      await service.applySupplierReturns([]);

      expect(tx.supplierReturn.upsert).not.toHaveBeenCalled();
      const { getSupplierReturnsLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getSupplierReturnsLastSyncedAt()).not.toBeNull();
    });

    it("wraps all upserts in a single $transaction", async () => {
      await service.applySupplierReturns([makeReturnRow() as any, makeReturnRow({ id: "ret-2", sequentialNumber: 2 }) as any]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.supplierReturn.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("SupplierReturnSyncHttpError", () => {
    it("carries statusCode and responseBody", () => {
      const err = new SupplierReturnSyncHttpError("http://x", 500, "boom");
      expect(err.statusCode).toBe(500);
      expect(err.responseBody).toBe("boom");
      expect(err.name).toBe("SupplierReturnSyncHttpError");
    });
  });
});
