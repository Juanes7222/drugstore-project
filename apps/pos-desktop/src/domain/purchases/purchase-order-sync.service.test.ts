/**
 * Unit tests for PurchaseOrderSyncService — pulling purchase orders from server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@pharmacy/database/local";
import {
  createPurchaseOrderSyncService,
  PurchaseOrderSyncService,
  PurchaseOrderSyncHttpError,
} from "./purchase-order-sync.service";
import type { SyncHttpClient } from "../catalog/catalog-sync.service";

const makeMockPrisma = () => {
  const tx: any = {
    purchaseOrder: { upsert: vi.fn() },
    purchaseOrderItem: { upsert: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
  };
  const prisma = {
    $transaction: vi.fn(async (cb: (t: any) => unknown) => cb(tx)),
    purchaseOrder: tx.purchaseOrder,
    purchaseOrderItem: tx.purchaseOrderItem,
  } as any;
  return { prisma, tx };
};

const makeMockHttpClient = (): SyncHttpClient => ({ get: vi.fn() });

const makePoRow = (overrides: Record<string, unknown> = {}) => ({
  id: "po-1",
  sequentialNumber: 1,
  state: "DRAFT",
  supplierId: "supplier-1",
  expectedDeliveryDate: "2026-08-15T00:00:00Z",
  subtotal: "250000",
  totalTax: "0",
  totalAmount: "250000",
  notes: "Pedido urgente",
  createdAt: "2026-07-16T00:00:00Z",
  createdById: "user-1",
  confirmedAt: null,
  confirmedById: null,
  annulledAt: null,
  annulledById: null,
  annulmentReason: null,
  items: [
    {
      id: "item-1",
      productId: "prod-1",
      requestedQuantity: 10,
      receivedQuantity: 0,
      pendingQuantity: 10,
      expectedUnitCost: "25000",
    },
  ],
  ...overrides,
});

describe("PurchaseOrderSyncService", () => {
  let prisma: any;
  let tx: any;
  let http: SyncHttpClient;
  let service: PurchaseOrderSyncService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    http = makeMockHttpClient();
    service = createPurchaseOrderSyncService(prisma, {
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
    it("creates instance via createPurchaseOrderSyncService", () => {
      const instance = createPurchaseOrderSyncService(prisma, {
        baseUrl: "http://localhost:3000/",
        httpClient: http,
      });
      expect(instance).toBeInstanceOf(PurchaseOrderSyncService);
    });

    it("trims trailing slashes from baseUrl", async () => {
      const svc = createPurchaseOrderSyncService(prisma, {
        baseUrl: "http://localhost:3000///",
        httpClient: http,
      });
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await svc.fetchPurchaseOrders();
      const url = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(url).toContain("http://localhost:3000/purchases/purchase-orders/sync");
      expect(url).not.toContain("///purchases");
    });
  });

  describe("pullPurchaseOrders — isOnline guard", () => {
    it("does nothing when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      await service.pullPurchaseOrders();
      expect(http.get).not.toHaveBeenCalled();
      expect(tx.purchaseOrder.upsert).not.toHaveBeenCalled();
    });

    it("fetches and applies when online", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makePoRow()], nextCursor: null, hasMore: false });
      await service.pullPurchaseOrders();
      expect(tx.purchaseOrder.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchPurchaseOrders — cursor pagination", () => {
    it("fetches single page when hasMore is false", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makePoRow()], nextCursor: null, hasMore: false });
      const rows = await service.fetchPurchaseOrders();
      expect(rows).toHaveLength(1);
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it("paginates through multiple cursor pages", async () => {
      vi.mocked(http.get)
        .mockResolvedValueOnce({ data: [makePoRow({ id: "po-1" })], nextCursor: "cur-1", hasMore: true })
        .mockResolvedValueOnce({ data: [makePoRow({ id: "po-2" })], nextCursor: null, hasMore: false });
      const rows = await service.fetchPurchaseOrders();
      expect(rows).toHaveLength(2);
      expect(rows.map((r: any) => r.id)).toEqual(["po-1", "po-2"]);
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it("sends updatedSince when metadata has a timestamp", async () => {
      const { setPurchaseOrdersLastSyncedAt } = await import("../../common/sync-metadata");
      setPurchaseOrdersLastSyncedAt("2026-07-09T12:00:00.000Z");
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await service.fetchPurchaseOrders();
      const url = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(url).toContain("updatedSince=");
    });

    it("sends Authorization header when accessToken is configured", async () => {
      const authed = createPurchaseOrderSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        accessToken: "tok-123",
      });
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await authed.fetchPurchaseOrders();
      const headers = vi.mocked(http.get).mock.calls[0][1] as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok-123");
    });

    it("falls back to legacy offset pagination when cursor endpoint throws", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor not found"))
        .mockResolvedValueOnce({ data: [makePoRow()], total: 1, page: 1, pageSize: 200 });
      const rows = await service.fetchPurchaseOrders();
      expect(rows).toHaveLength(1);
      expect(http.get).toHaveBeenCalledTimes(2);
      expect(vi.mocked(http.get).mock.calls[1][0]).toContain("/purchases/purchase-orders?page=1");
    });

    it("legacy fallback paginates across multiple pages", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor unsupported"))
        .mockResolvedValueOnce({ data: [makePoRow({ id: "po-1" })], total: 400, page: 1, pageSize: 200 })
        .mockResolvedValueOnce({ data: [makePoRow({ id: "po-2" })], total: 400, page: 2, pageSize: 200 });
      const rows = await service.fetchPurchaseOrders();
      expect(rows).toHaveLength(2);
      expect(http.get).toHaveBeenCalledTimes(3);
    });
  });

  describe("applyPurchaseOrders", () => {
    it("upserts purchase orders and items, records syncedAt", async () => {
      const row = makePoRow();

      await service.applyPurchaseOrders([row as any]);

      expect(tx.purchaseOrder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "po-1" },
          create: expect.objectContaining({
            id: "po-1",
            sequentialNumber: 1,
            supplierId: "supplier-1",
          }),
        }),
      );

      const { getPurchaseOrdersLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getPurchaseOrdersLastSyncedAt()).not.toBeNull();
    });

    it("maps monetary fields to Prisma.Decimal and dates to Date", async () => {
      const row = makePoRow({ subtotal: "123.45", totalTax: "19.00", totalAmount: "142.45" });

      await service.applyPurchaseOrders([row as any]);

      expect(tx.purchaseOrder.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            subtotal: new Prisma.Decimal("123.45"),
            totalTax: new Prisma.Decimal("19.00"),
            totalAmount: new Prisma.Decimal("142.45"),
            expectedDeliveryDate: new Date("2026-08-15T00:00:00Z"),
          }),
        }),
      );
    });

    it("deletes orphan items not in payload then upserts each item", async () => {
      const row = makePoRow({
        items: [
          { id: "item-1", productId: "prod-1", requestedQuantity: 5, receivedQuantity: 0, pendingQuantity: 5, expectedUnitCost: "100" },
          { id: "item-2", productId: "prod-2", requestedQuantity: 3, receivedQuantity: 0, pendingQuantity: 3, expectedUnitCost: "200" },
        ],
      });

      await service.applyPurchaseOrders([row as any]);

      expect(tx.purchaseOrderItem.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { purchaseOrderId: "po-1", id: { notIn: expect.arrayContaining(["item-1", "item-2"]) } },
        }),
      );
      expect(tx.purchaseOrderItem.upsert).toHaveBeenCalledTimes(2);
      expect(tx.purchaseOrderItem.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "item-1" },
          create: expect.objectContaining({
            productId: "prod-1",
            requestedQuantity: 5,
            expectedUnitCost: new Prisma.Decimal("100"),
          }),
        }),
      );
    });

    it("deletes all items when incoming items array is empty", async () => {
      const row = makePoRow({ items: [] });

      await service.applyPurchaseOrders([row as any]);

      expect(tx.purchaseOrderItem.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { purchaseOrderId: "po-1", id: { notIn: [] } },
        }),
      );
      expect(tx.purchaseOrderItem.upsert).not.toHaveBeenCalled();
    });

    it("still records syncedAt when rows array is empty", async () => {
      await service.applyPurchaseOrders([]);

      expect(tx.purchaseOrder.upsert).not.toHaveBeenCalled();
      const { getPurchaseOrdersLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getPurchaseOrdersLastSyncedAt()).not.toBeNull();
    });

    it("wraps all upserts in a single $transaction", async () => {
      await service.applyPurchaseOrders([makePoRow() as any, makePoRow({ id: "po-2", sequentialNumber: 2 }) as any]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.purchaseOrder.upsert).toHaveBeenCalledTimes(2);
    });

    it("propagates http error when fetch fails entirely", async () => {
      vi.mocked(http.get).mockRejectedValue(new Error("network down"));
      await expect(service.pullPurchaseOrders()).rejects.toThrow();
    });
  });

  describe("PurchaseOrderSyncHttpError", () => {
    it("carries statusCode and responseBody", () => {
      const err = new PurchaseOrderSyncHttpError("http://x", 500, "boom");
      expect(err.statusCode).toBe(500);
      expect(err.responseBody).toBe("boom");
      expect(err.name).toBe("PurchaseOrderSyncHttpError");
    });
  });
});
