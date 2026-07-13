/**
 * Unit tests for CatalogSyncService — pulling product catalog from server.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createCatalogSyncService, type CatalogSyncService, CatalogSyncHttpError } from "./catalog-sync.service";
import type { SyncHttpClient } from "./catalog-sync.service";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const makeMockPrisma = () => {
  const tx: any = {
    category: { upsert: vi.fn() },
    pharmaceuticalForm: { upsert: vi.fn() },
    product: { upsert: vi.fn() },
    productBarcode: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  };

  const transaction = vi.fn(async (cb: (t: any) => unknown) => cb(tx));

  const prisma = {
    $transaction: transaction,
    category: tx.category,
    pharmaceuticalForm: tx.pharmaceuticalForm,
    product: tx.product,
    productBarcode: tx.productBarcode,
  } as any;

  return { prisma, tx };
};

const makeMockHttpClient = (): SyncHttpClient => ({
  get: vi.fn(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CatalogSyncService", () => {
  let prisma: any;
  let tx: any;
  let http: SyncHttpClient;
  let service: CatalogSyncService;

  beforeEach(() => {
    const mocks = makeMockPrisma();
    prisma = mocks.prisma;
    tx = mocks.tx;
    http = makeMockHttpClient();
    service = createCatalogSyncService(prisma, {
      baseUrl: "http://localhost:3000",
      httpClient: http,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("pullCatalog", () => {
    it("fetches categories, forms, and products; upserts them locally", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get)
        .mockResolvedValueOnce([{ id: "cat-1", name: "Analgésicos", sortOrder: 1 }]) // categories
        .mockResolvedValueOnce([{ id: "form-1", name: "Tableta", sortOrder: 1 }])   // forms
        .mockResolvedValueOnce({                                                      // products page 1
          items: [{
            id: "prod-1",
            internalCode: "P001",
            commercialName: "Acetaminofén",
            genericName: "Acetaminofén",
            activePrinciple: "Acetaminofén",
            laboratory: "Genfar",
            saleType: "FREE_SALE",
            minimumStock: 10,
            isActive: true,
            createdById: "user-1",
            barcodes: [{ id: "bc-1", barcode: "7701234567890", barcodeType: "EAN13", isPrimary: true }],
          }],
          total: 1, page: 1, pageSize: 200, totalPages: 1,
        });

      await service.pullCatalog();

      // Verify upserts happened
      expect(tx.category.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "cat-1" },
          create: expect.objectContaining({ name: "Analgésicos" }),
          update: expect.objectContaining({ name: "Analgésicos" }),
        }),
      );
      expect(tx.pharmaceuticalForm.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "form-1" },
        }),
      );
      expect(tx.product.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "prod-1" },
        }),
      );

      vi.unstubAllGlobals();
    });

    it("does nothing when offline (isOnline returns false)", async () => {
      vi.stubGlobal("navigator", { onLine: false });

      await service.pullCatalog();

      expect(http.get).not.toHaveBeenCalled();
      expect(tx.product.upsert).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });

    it("throws CatalogSyncHttpError on HTTP error", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get).mockRejectedValue(
        new CatalogSyncHttpError("/catalog/categories", 500, "Server error"),
      );

      await expect(service.pullCatalog()).rejects.toThrow(CatalogSyncHttpError);

      vi.unstubAllGlobals();
    });

    it("paginates through all product pages", async () => {
      vi.stubGlobal("navigator", { onLine: true });

      vi.mocked(http.get)
        .mockResolvedValueOnce([])  // categories
        .mockResolvedValueOnce([])  // forms
        .mockResolvedValueOnce({    // page 1
          items: [{ id: "prod-1", internalCode: "P001", commercialName: "A", genericName: "A", activePrinciple: "A", laboratory: "L", saleType: "FREE_SALE", minimumStock: 5, isActive: true, createdById: "u1" }],
          total: 3, page: 1, pageSize: 2, totalPages: 2,
        })
        .mockResolvedValueOnce({    // page 2
          items: [{ id: "prod-2", internalCode: "P002", commercialName: "B", genericName: "B", activePrinciple: "B", laboratory: "L", saleType: "FREE_SALE", minimumStock: 5, isActive: true, createdById: "u1" }],
          total: 3, page: 2, pageSize: 2, totalPages: 2,
        });

      await service.pullCatalog();

      // Should have upserted both products
      expect(tx.product.upsert).toHaveBeenCalledTimes(2);

      vi.unstubAllGlobals();
    });
  });
});
