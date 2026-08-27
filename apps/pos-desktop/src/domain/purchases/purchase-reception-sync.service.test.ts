/**
 * Unit tests for PurchaseReceptionSyncService — pulling receptions from server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@pharmacy/database/local";
import {
  createPurchaseReceptionSyncService,
  PurchaseReceptionSyncService,
  PurchaseReceptionSyncHttpError,
} from "./purchase-reception-sync.service";
import type { SyncHttpClient } from "../catalog/catalog-sync.service";

const makeMockPrisma = () => {
  const tx: any = {
    purchaseReception: { upsert: vi.fn() },
    purchaseReceptionItem: { upsert: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: any) => unknown) => cb(tx)),
    purchaseReception: tx.purchaseReception,
    purchaseReceptionItem: tx.purchaseReceptionItem,
  } as any;
  return { prisma, tx };
};

const makeMockHttpClient = (): SyncHttpClient => ({ get: vi.fn() });

const makeReceptionRow = (overrides: Record<string, unknown> = {}) => ({
  id: "reception-1",
  sequentialNumber: 1,
  state: "CONFIRMED",
  supplierId: "supplier-1",
  purchaseOrderId: "po-1",
  notes: "Entrega parcial",
  subtotal: "100000",
  totalTax: "19000",
  totalAmount: "119000",
  createdAt: "2026-07-16T00:00:00Z",
  createdById: "user-1",
  receivedAt: "2026-07-17T00:00:00Z",
  annulledAt: null,
  updatedAt: "2026-07-17T10:00:00Z",
  items: [
    {
      id: "recv-item-1",
      productId: "prod-1",
      purchaseOrderItemId: "po-item-1",
      lotId: "lot-1",
      receivedQuantity: 10,
      lotNumber: "LOT-001",
      expirationDate: "2027-01-01T00:00:00Z",
      realUnitCost: "10000",
      taxSchemeId: "iva-19",
      taxRate: "0.19",
      taxAmount: "19000",
      discountAmount: "0",
      subtotal: "100000",
      total: "119000",
    },
  ],
  ...overrides,
});

describe("PurchaseReceptionSyncService", () => {
  let prisma: any;
  let tx: any;
  let http: SyncHttpClient;
  let service: PurchaseReceptionSyncService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    http = makeMockHttpClient();
    service = createPurchaseReceptionSyncService(prisma, {
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
    it("creates instance via createPurchaseReceptionSyncService", () => {
      const instance = createPurchaseReceptionSyncService(prisma, {
        baseUrl: "http://localhost:3000/",
        httpClient: http,
      });
      expect(instance).toBeInstanceOf(PurchaseReceptionSyncService);
    });

    it("trims trailing slashes from baseUrl", async () => {
      const svc = createPurchaseReceptionSyncService(prisma, {
        baseUrl: "http://localhost:3000///",
        httpClient: http,
      });
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await svc.fetchReceptions();
      const url = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(url).toContain("http://localhost:3000/purchases/receptions/sync");
    });
  });

  describe("pullReceptions — isOnline guard", () => {
    it("does nothing when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      await service.pullReceptions();
      expect(http.get).not.toHaveBeenCalled();
      expect(tx.purchaseReception.upsert).not.toHaveBeenCalled();
    });

    it("fetches and applies when online", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makeReceptionRow()], nextCursor: null, hasMore: false });
      await service.pullReceptions();
      expect(tx.purchaseReception.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchReceptions — cursor pagination", () => {
    it("fetches single page when hasMore is false", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makeReceptionRow()], nextCursor: null, hasMore: false });
      const rows = await service.fetchReceptions();
      expect(rows).toHaveLength(1);
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it("paginates through multiple cursor pages", async () => {
      vi.mocked(http.get)
        .mockResolvedValueOnce({ data: [makeReceptionRow({ id: "r-1" })], nextCursor: "cur-1", hasMore: true })
        .mockResolvedValueOnce({ data: [makeReceptionRow({ id: "r-2" })], nextCursor: null, hasMore: false });
      const rows = await service.fetchReceptions();
      expect(rows).toHaveLength(2);
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it("sends updatedSince when metadata has a timestamp", async () => {
      const { setPurchaseReceptionsLastSyncedAt } = await import("../../common/sync-metadata");
      setPurchaseReceptionsLastSyncedAt("2026-07-09T12:00:00.000Z");
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await service.fetchReceptions();
      const url = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(url).toContain("updatedSince=");
    });

    it("sends Authorization header when accessToken is configured", async () => {
      const authed = createPurchaseReceptionSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        accessToken: "tok-123",
      });
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await authed.fetchReceptions();
      const headers = vi.mocked(http.get).mock.calls[0][1] as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok-123");
    });

    it("falls back to legacy offset pagination when cursor endpoint throws", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor not found"))
        .mockResolvedValueOnce({ data: [makeReceptionRow()], total: 1, page: 1, pageSize: 200 });
      const rows = await service.fetchReceptions();
      expect(rows).toHaveLength(1);
      expect(http.get).toHaveBeenCalledTimes(2);
      expect(vi.mocked(http.get).mock.calls[1][0]).toContain("/purchases/receptions?page=1");
    });

    it("legacy fallback paginates across multiple pages", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor unsupported"))
        .mockResolvedValueOnce({ data: [makeReceptionRow({ id: "r-1" })], total: 400, page: 1, pageSize: 200 })
        .mockResolvedValueOnce({ data: [makeReceptionRow({ id: "r-2" })], total: 400, page: 2, pageSize: 200 });
      const rows = await service.fetchReceptions();
      expect(rows).toHaveLength(2);
      expect(http.get).toHaveBeenCalledTimes(3);
    });
  });

  describe("applyReceptions", () => {
    it("upserts reception and items, records syncedAt", async () => {
      const row = makeReceptionRow();

      await service.applyReceptions([row as any]);

      expect(tx.purchaseReception.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "reception-1" },
          create: expect.objectContaining({
            id: "reception-1",
            sequentialNumber: 1,
            supplierId: "supplier-1",
          }),
        }),
      );

      const { getPurchaseReceptionsLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getPurchaseReceptionsLastSyncedAt()).not.toBeNull();
    });

    it("maps monetary fields to Prisma.Decimal and dates to Date", async () => {
      const row = makeReceptionRow({ subtotal: "123.45", totalTax: "19.00", totalAmount: "142.45" });

      await service.applyReceptions([row as any]);

      expect(tx.purchaseReception.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            subtotal: new Prisma.Decimal("123.45"),
            totalTax: new Prisma.Decimal("19.00"),
            totalAmount: new Prisma.Decimal("142.45"),
            receivedAt: new Date("2026-07-17T00:00:00Z"),
          }),
        }),
      );
    });

    it("deletes orphan items not in payload then upserts each item", async () => {
      const row = makeReceptionRow({
        items: [
          {
            id: "recv-item-1",
            productId: "prod-1",
            purchaseOrderItemId: "po-item-1",
            lotId: "lot-1",
            receivedQuantity: 5,
            lotNumber: "LOT-001",
            expirationDate: "2027-01-01T00:00:00Z",
            realUnitCost: "10000",
            taxSchemeId: "iva-19",
            taxRate: "0.19",
            taxAmount: "1900",
            discountAmount: "0",
            subtotal: "50000",
            total: "51900",
          },
          {
            id: "recv-item-2",
            productId: "prod-2",
            purchaseOrderItemId: null,
            lotId: null,
            receivedQuantity: 3,
            lotNumber: null,
            expirationDate: null,
            realUnitCost: "20000",
            taxSchemeId: "iva-19",
            taxRate: "0.19",
            taxAmount: "11400",
            discountAmount: "0",
            subtotal: "60000",
            total: "71400",
          },
        ],
      });

      await service.applyReceptions([row as any]);

      expect(tx.purchaseReceptionItem.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { purchaseReceptionId: "reception-1", id: { notIn: expect.arrayContaining(["recv-item-1", "recv-item-2"]) } },
        }),
      );
      expect(tx.purchaseReceptionItem.upsert).toHaveBeenCalledTimes(2);
      expect(tx.purchaseReceptionItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "recv-item-1" },
          create: expect.objectContaining({
            productId: "prod-1",
            realUnitCost: new Prisma.Decimal("10000"),
            taxSchemeId: "iva-19",
          }),
        }),
      );
    });

    it("handles null lotId and null dates gracefully", async () => {
      const row = makeReceptionRow({
        items: [
          {
            id: "recv-item-1",
            productId: "prod-1",
            purchaseOrderItemId: null,
            lotId: null,
            receivedQuantity: 1,
            lotNumber: null,
            expirationDate: null,
            realUnitCost: "5000",
            taxSchemeId: "exento",
            taxRate: "0",
            taxAmount: "0",
            discountAmount: "0",
            subtotal: "5000",
            total: "5000",
          },
        ],
      });

      await service.applyReceptions([row as any]);

      expect(tx.purchaseReceptionItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            lotId: null,
            lotNumber: null,
            expirationDate: null,
          }),
        }),
      );
    });

    it("still records syncedAt when rows array is empty", async () => {
      await service.applyReceptions([]);

      expect(tx.purchaseReception.upsert).not.toHaveBeenCalled();
      const { getPurchaseReceptionsLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getPurchaseReceptionsLastSyncedAt()).not.toBeNull();
    });

    it("wraps all upserts in a single $transaction", async () => {
      await service.applyReceptions([makeReceptionRow() as any, makeReceptionRow({ id: "r-2", sequentialNumber: 2 }) as any]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.purchaseReception.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("PurchaseReceptionSyncHttpError", () => {
    it("carries statusCode and responseBody", () => {
      const err = new PurchaseReceptionSyncHttpError("http://x", 500, "boom");
      expect(err.statusCode).toBe(500);
      expect(err.responseBody).toBe("boom");
      expect(err.name).toBe("PurchaseReceptionSyncHttpError");
    });
  });
});
