/**
 * Unit tests for SalesSyncService — pulling sales history from server.
 *
 * Covers isOnline guard, cursor pagination with updatedSince, legacy fallback
 * with 50-page cap, applySales with SyncQueue pending guard, orphan delete,
 * Authorization header, and SalesSyncHttpError.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Prisma } from "@pharmacy/database/local";
import {
  createSalesSyncService,
  SalesSyncService,
  SalesSyncHttpError,
} from "./sales-sync.service";
import type { SyncHttpClient } from "../catalog/catalog-sync.service";

const makeMockPrisma = (overrides?: { syncQueueFindMany?: unknown }) => {
  const tx: any = {
    sale: { upsert: vi.fn() },
    saleItem: { upsert: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    salePayment: { upsert: vi.fn(), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
    cashShift: {
      findUnique: vi.fn().mockResolvedValue({ id: "shift-1" }),
      create: vi.fn().mockResolvedValue({ id: "shift-1" }),
    },
    client: {
      findUnique: vi.fn().mockResolvedValue({ id: "client-1" }),
    },
  };

  const prisma = {
    $transaction: vi.fn(async (cb: (t: any) => unknown) => cb(tx)),
    sale: tx.sale,
    saleItem: tx.saleItem,
    salePayment: tx.salePayment,
    syncQueue: {
      findMany: vi.fn().mockResolvedValue(overrides?.syncQueueFindMany ?? []),
    },
  } as any;

  return { prisma, tx };
};

const makeMockHttpClient = (): SyncHttpClient => ({ get: vi.fn() });

const makeSaleRow = (overrides: Record<string, unknown> = {}) => ({
  id: "sale-1",
  localNumber: 1001,
  operationalState: "CONFIRMED",
  startedAt: "2026-07-16T10:00:00Z",
  confirmedAt: "2026-07-16T10:05:00Z",
  lastModifiedAt: "2026-07-16T10:05:00Z",
  clientId: "client-1",
  clientNameSnapshot: "Juan Perez",
  clientIdentificationTypeSnapshot: "CC",
  clientIdentificationNumberSnapshot: "12345678",
  subtotal: "100000",
  totalDiscount: "5000",
  totalTax: "18000",
  totalAmount: "113000",
  changeAmount: "0",
  cashShiftId: "shift-1",
  workstationId: "ws-1",
  userId: "user-1",
  sourceWorkstationId: "ws-1",
  delivery: null,
  items: [
    {
      id: "item-1",
      productId: "prod-1",
      quantity: 2,
      unitPrice: "50000",
      discountPercentage: "0",
      discountAmount: "0",
      discountReason: null,
      taxRate: "0.19",
      taxAmount: "19000",
      subtotal: "100000",
      total: "119000",
      productInternalCodeSnapshot: "P001",
      productCommercialNameSnapshot: "Acetaminofen",
      productGenericNameSnapshot: null,
      productConcentrationSnapshot: "500mg",
    },
  ],
  payments: [
    {
      id: "pay-1",
      paymentMethodId: "pm-cash",
      amount: "113000",
      transactionReference: null,
      authorizationCode: null,
      cardBrand: null,
      cardLastFour: null,
      batchNumber: null,
      processorResponseCode: null,
    },
  ],
  ...overrides,
});

describe("SalesSyncService", () => {
  let prisma: any;
  let tx: any;
  let http: SyncHttpClient;
  let service: SalesSyncService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    http = makeMockHttpClient();
    service = createSalesSyncService(prisma, {
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
    it("creates instance via createSalesSyncService", () => {
      const instance = createSalesSyncService(prisma, {
        baseUrl: "http://localhost:3000/",
        httpClient: http,
      });
      expect(instance).toBeInstanceOf(SalesSyncService);
    });

    it("trims trailing slashes from baseUrl", async () => {
      const svc = createSalesSyncService(prisma, {
        baseUrl: "http://localhost:3000///",
        httpClient: http,
      });
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await svc.fetchSales();
      const url = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(url).toContain("http://localhost:3000/sales-pos/sync");
    });
  });

  describe("pullSales — isOnline guard", () => {
    it("does nothing when offline", async () => {
      vi.stubGlobal("navigator", { onLine: false });
      await service.pullSales();
      expect(http.get).not.toHaveBeenCalled();
      expect(tx.sale.upsert).not.toHaveBeenCalled();
    });

    it("fetches and applies when online", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makeSaleRow()], nextCursor: null, hasMore: false });
      await service.pullSales();
      expect(tx.sale.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe("fetchSales — cursor pagination", () => {
    it("fetches single page when hasMore is false", async () => {
      vi.mocked(http.get).mockResolvedValue({ data: [makeSaleRow()], nextCursor: null, hasMore: false });
      const rows = await service.fetchSales();
      expect(rows).toHaveLength(1);
      expect(http.get).toHaveBeenCalledTimes(1);
    });

    it("paginates through multiple cursor pages", async () => {
      vi.mocked(http.get)
        .mockResolvedValueOnce({ data: [makeSaleRow({ id: "sale-1" })], nextCursor: "cur-1", hasMore: true })
        .mockResolvedValueOnce({ data: [makeSaleRow({ id: "sale-2" })], nextCursor: null, hasMore: false });
      const rows = await service.fetchSales();
      expect(rows).toHaveLength(2);
      expect(http.get).toHaveBeenCalledTimes(2);
    });

    it("sends updatedSince when metadata has a timestamp", async () => {
      const { setSalesLastSyncedAt } = await import("../../common/sync-metadata");
      setSalesLastSyncedAt("2026-07-09T12:00:00.000Z");
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await service.fetchSales();
      const url = vi.mocked(http.get).mock.calls[0][0] as string;
      expect(url).toContain("updatedSince=");
    });

    it("sends Authorization header when accessToken is configured", async () => {
      const authed = createSalesSyncService(prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
        accessToken: "tok-123",
      });
      vi.mocked(http.get).mockResolvedValue({ data: [], nextCursor: null, hasMore: false });
      await authed.fetchSales();
      const headers = vi.mocked(http.get).mock.calls[0][1] as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok-123");
    });

    it("falls back to legacy offset pagination when cursor endpoint throws", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor not found"))
        .mockResolvedValueOnce({ data: [makeSaleRow()], total: 1, page: 1, pageSize: 100 });
      const rows = await service.fetchSales();
      expect(rows).toHaveLength(1);
      expect(http.get).toHaveBeenCalledTimes(2);
      expect(vi.mocked(http.get).mock.calls[1][0]).toContain("/sales-pos?page=1");
    });

    it("legacy fallback paginates and respects 50-page cap", async () => {
      // Simulate a huge history that would require >50 pages: each page returns total=6000 with pageSize 100 => 60 pages but cap at 50
      vi.mocked(http.get).mockRejectedValueOnce(new Error("cursor unsupported"));
      // Generate 51 pages worth of responses — service should break after page 50
      for (let page = 1; page <= 51; page++) {
        vi.mocked(http.get).mockResolvedValueOnce({
          data: [makeSaleRow({ id: `sale-${page}` })],
          total: 6000,
          page,
          pageSize: 100,
        });
      }
      const rows = await service.fetchSales();
      // Should have stopped at 50: initial cursor failure + 50 legacy pages = 51 calls, but rows capped at 50
      expect(rows.length).toBe(50);
      // The cap is checked via `if (page > 50) break;` after incrementing, so page 51 is still fetched but then break
      // Actually after page 50, page becomes 51 and break triggers — so 50 legacy pages fetched
      expect(http.get).toHaveBeenCalledTimes(51);
    });

    it("legacy fallback uses pageSize 100", async () => {
      vi.mocked(http.get)
        .mockRejectedValueOnce(new Error("cursor unsupported"))
        .mockResolvedValueOnce({ data: [makeSaleRow()], total: 1, page: 1, pageSize: 100 });
      await service.fetchSales();
      const url = vi.mocked(http.get).mock.calls[1][0] as string;
      expect(url).toContain("pageSize=100");
    });
  });

  describe("applySales", () => {
    it("upserts sale with items and payments, records syncedAt", async () => {
      const row = makeSaleRow();

      await service.applySales([row as any]);

      expect(tx.sale.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "sale-1" },
          create: expect.objectContaining({
            id: "sale-1",
            localNumber: BigInt(1001),
            cashShiftId: "shift-1",
          }),
        }),
      );

      const { getSalesLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getSalesLastSyncedAt()).not.toBeNull();
    });

    it("maps monetary fields to Prisma.Decimal and dates to Date", async () => {
      const row = makeSaleRow({ subtotal: "123.45", totalDiscount: "5.00", totalTax: "19.00", totalAmount: "137.45" });

      await service.applySales([row as any]);

      expect(tx.sale.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            subtotal: new Prisma.Decimal("123.45"),
            totalDiscount: new Prisma.Decimal("5.00"),
            totalTax: new Prisma.Decimal("19.00"),
            totalAmount: new Prisma.Decimal("137.45"),
          }),
        }),
      );
    });

    it("deletes orphan items and payments not in payload", async () => {
      const row = makeSaleRow({
        items: [
          { id: "item-1", productId: "prod-1", quantity: 1, unitPrice: "100", discountPercentage: "0", discountAmount: "0", discountReason: null, taxRate: "0.19", taxAmount: "19", subtotal: "100", total: "119", productInternalCodeSnapshot: "P001", productCommercialNameSnapshot: "A", productGenericNameSnapshot: null, productConcentrationSnapshot: null },
          { id: "item-2", productId: "prod-2", quantity: 1, unitPrice: "200", discountPercentage: "0", discountAmount: "0", discountReason: null, taxRate: "0.19", taxAmount: "38", subtotal: "200", total: "238", productInternalCodeSnapshot: "P002", productCommercialNameSnapshot: "B", productGenericNameSnapshot: null, productConcentrationSnapshot: null },
        ],
        payments: [
          { id: "pay-1", paymentMethodId: "pm-1", amount: "100", transactionReference: null, authorizationCode: null, cardBrand: null, cardLastFour: null, batchNumber: null, processorResponseCode: null },
          { id: "pay-2", paymentMethodId: "pm-2", amount: "50", transactionReference: null, authorizationCode: null, cardBrand: null, cardLastFour: null, batchNumber: null, processorResponseCode: null },
        ],
      });

      await service.applySales([row as any]);

      expect(tx.saleItem.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { saleId: "sale-1", id: { notIn: expect.arrayContaining(["item-1", "item-2"]) } },
        }),
      );
      expect(tx.salePayment.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { saleId: "sale-1", id: { notIn: expect.arrayContaining(["pay-1", "pay-2"]) } },
        }),
      );
      expect(tx.saleItem.upsert).toHaveBeenCalledTimes(2);
      expect(tx.salePayment.upsert).toHaveBeenCalledTimes(2);
    });

    it("still records syncedAt when rows array is empty", async () => {
      await service.applySales([]);

      expect(tx.sale.upsert).not.toHaveBeenCalled();
      const { getSalesLastSyncedAt } = await import("../../common/sync-metadata");
      expect(getSalesLastSyncedAt()).not.toBeNull();
    });

    it("wraps all upserts in a single $transaction", async () => {
      await service.applySales([makeSaleRow() as any, makeSaleRow({ id: "sale-2", localNumber: 1002 }) as any]);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.sale.upsert).toHaveBeenCalledTimes(2);
    });

    it("skips rows where SyncQueue has PENDING SALE_CONFIRMATION for same sale id", async () => {
      const pendingPayload = JSON.stringify({ metadata: { localSaleId: "sale-1" } });
      const prismaWithPending = makeMockPrisma({
        syncQueueFindMany: [{ payload: pendingPayload }],
      });
      const svc = createSalesSyncService(prismaWithPending.prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
      });

      await svc.applySales([makeSaleRow({ id: "sale-1" }) as any, makeSaleRow({ id: "sale-2", localNumber: 1002 }) as any]);

      // sale-1 should be skipped, sale-2 upserted
      expect(prismaWithPending.tx.sale.upsert).toHaveBeenCalledTimes(1);
      expect(prismaWithPending.tx.sale.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "sale-2" } }),
      );
    });

    it("skips rows where SyncQueue has FAILED SALE_CONFIRMATION", async () => {
      const failedPayload = JSON.stringify({ metadata: { localSaleId: "sale-99" } });
      const prismaWithFailed = makeMockPrisma({
        syncQueueFindMany: [{ payload: failedPayload }],
      });
      const svc = createSalesSyncService(prismaWithFailed.prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
      });

      await svc.applySales([makeSaleRow({ id: "sale-99" }) as any]);

      expect(prismaWithFailed.tx.sale.upsert).not.toHaveBeenCalled();
    });

    it("does not skip when SyncQueue payload is for a different sale id", async () => {
      const otherPayload = JSON.stringify({ metadata: { localSaleId: "other-sale" } });
      const prismaOther = makeMockPrisma({
        syncQueueFindMany: [{ payload: otherPayload }],
      });
      const svc = createSalesSyncService(prismaOther.prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
      });

      await svc.applySales([makeSaleRow({ id: "sale-1" }) as any]);

      expect(prismaOther.tx.sale.upsert).toHaveBeenCalledTimes(1);
    });

    it("ignores malformed SyncQueue payload JSON and still applies", async () => {
      const prismaBad = makeMockPrisma({
        syncQueueFindMany: [{ payload: "not-json" }],
      });
      const svc = createSalesSyncService(prismaBad.prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
      });

      await svc.applySales([makeSaleRow() as any]);

      expect(prismaBad.tx.sale.upsert).toHaveBeenCalledTimes(1);
    });

    it("ignores SyncQueue entries without metadata.localSaleId", async () => {
      const noIdPayload = JSON.stringify({ something: "else" });
      const prismaNoId = makeMockPrisma({
        syncQueueFindMany: [{ payload: noIdPayload }],
      });
      const svc = createSalesSyncService(prismaNoId.prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
      });

      await svc.applySales([makeSaleRow() as any]);

      expect(prismaNoId.tx.sale.upsert).toHaveBeenCalledTimes(1);
    });

    it("continues when syncQueue table does not exist (findMany throws)", async () => {
      const prismaNoTable = makeMockPrisma();
      prismaNoTable.prisma.syncQueue.findMany = vi.fn().mockRejectedValue(new Error("no such table"));

      const svc = createSalesSyncService(prismaNoTable.prisma, {
        baseUrl: "http://localhost:3000",
        httpClient: http,
      });

      await svc.applySales([makeSaleRow() as any]);

      expect(prismaNoTable.tx.sale.upsert).toHaveBeenCalledTimes(1);
    });

    it("handles sales with empty items and payments arrays", async () => {
      const row = makeSaleRow({ items: [], payments: [] });

      await service.applySales([row as any]);

      expect(tx.sale.upsert).toHaveBeenCalledTimes(1);
      expect(tx.saleItem.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { saleId: "sale-1", id: { notIn: [] } } }),
      );
      expect(tx.salePayment.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { saleId: "sale-1", id: { notIn: [] } } }),
      );
      expect(tx.saleItem.upsert).not.toHaveBeenCalled();
      expect(tx.salePayment.upsert).not.toHaveBeenCalled();
    });

    it("maps string localNumber to BigInt", async () => {
      const row = makeSaleRow({ localNumber: "9999" });

      await service.applySales([row as any]);

      expect(tx.sale.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ localNumber: BigInt(9999) }),
        }),
      );
    });
  });

  describe("SalesSyncHttpError", () => {
    it("carries statusCode and responseBody", () => {
      const err = new SalesSyncHttpError("http://x", 500, "boom");
      expect(err.statusCode).toBe(500);
      expect(err.responseBody).toBe("boom");
      expect(err.name).toBe("SalesSyncHttpError");
    });
  });
});
