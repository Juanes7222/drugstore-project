/**
 * Tests for the HTTP catalog service implementation.
 *
 * The service maps server-shaped product/lot responses into CatalogItem
 * objects. These tests verify the mapping logic, the hasCompleteData flag,
 * and edge cases (null prices, inactive products, empty results).
 */
import { describe, expect, it, vi } from "vitest";
import { createHttpCatalogService } from "./catalog-service.http";
import type { HttpClient } from "@infra/http-client";
import { SaleType } from "@pharmacy/shared-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const createMockHttpClient = (
  products: unknown[],
  lots: unknown = { data: [] },
) => {
  // Default lots response — no active lots for any product.
  const httpClient: HttpClient = {
    get: vi.fn().mockImplementation((path: string) => {
      if (path === "/catalog/products") {
        return Promise.resolve({ items: products, total: products.length, page: 1, pageSize: 20, totalPages: 1 });
      }
      if (path === "/inventory-lots/lots") {
        return Promise.resolve(lots);
      }
      return Promise.reject(new Error("Unknown path"));
    }),
  };
  return httpClient;
};

const baseServerProduct = {
  id: "prod-001",
  commercialName: "Acetaminofén 500mg",
  genericName: "Paracetamol",
  saleType: SaleType.FREE_SALE,
  minimumStock: 10,
  isActive: true,
  invimaRegistry: "INVIMA-2020M-001234",
  currentPrice: { price: 5000 },
  currentTax: { taxScheme: { rate: 0.19 } },
};

const baseServerLot = {
  id: "lot-001",
  batchNumber: "L-2026A",
  expirationDate: "2027-12-01T00:00:00Z",
  currentStock: 100,
  state: "ACTIVE",
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("createHttpCatalogService", () => {
  describe("search", () => {
    it("returns an empty array for an empty query string", async () => {
      const httpClient = createMockHttpClient([]);
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("");
      expect(result).toEqual([]);
    });

    it("returns an empty array for whitespace-only query", async () => {
      const httpClient = createMockHttpClient([]);
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("   ");
      expect(result).toEqual([]);
    });

    it("returns an empty array when the server returns no products", async () => {
      const httpClient = createMockHttpClient([]);
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("nonexistent");
      expect(result).toEqual([]);
    });

    it("maps a server product with active lots to a complete CatalogItem", async () => {
      const httpClient = createMockHttpClient([baseServerProduct], {
        data: [baseServerLot],
      });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("acetaminofén");

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: "prod-001",
        name: "Acetaminofén 500mg",
        genericName: "Paracetamol",
        barcode: "",
        invimaCertificate: "INVIMA-2020M-001234",
        saleType: SaleType.FREE_SALE,
        requiresPrescription: false,
        isRestricted: false,
        unitPriceCents: 5000 * 100, // 5000 → 500000 cents
        taxPercentage: 19,
        currentStock: 100,
        minimumStock: 10,
        isActive: true,
        lotCode: "L-2026A",
        lotExpirationDate: "2027-12-01T00:00:00Z",
        hasCompleteData: true,
      });
    });

    it("resolves the primary barcode when available", async () => {
      const product = {
        ...baseServerProduct,
        barcodes: [
          { barcode: "7701234567890", isPrimary: true },
          { barcode: "7709876543210", isPrimary: false },
        ],
      };
      const httpClient = createMockHttpClient([product], { data: [baseServerLot] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("acetaminofén");
      expect(result[0]?.barcode).toBe("7701234567890");
    });

    it("falls back to the first barcode when none is primary", async () => {
      const product = {
        ...baseServerProduct,
        barcodes: [
          { barcode: "1111111111111", isPrimary: false },
        ],
      };
      const httpClient = createMockHttpClient([product], { data: [baseServerLot] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("acetaminofén");
      expect(result[0]?.barcode).toBe("1111111111111");
    });

    it("returns empty string for barcode when none are provided", async () => {
      const product = { ...baseServerProduct, barcodes: null };
      const httpClient = createMockHttpClient([product], { data: [baseServerLot] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("acetaminofén");
      expect(result[0]?.barcode).toBe("");
    });

    it("marks product as requiring a prescription when saleType is not FREE_SALE", async () => {
      const product = { ...baseServerProduct, saleType: SaleType.PRESCRIPTION };
      const httpClient = createMockHttpClient([product], { data: [baseServerLot] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("prescription");
      expect(result[0]?.requiresPrescription).toBe(true);
    });

    it("marks product as restricted when saleType is CONTROLLED_SUBSTANCE", async () => {
      const product = { ...baseServerProduct, saleType: SaleType.CONTROLLED_SUBSTANCE };
      const httpClient = createMockHttpClient([product], { data: [baseServerLot] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("controlled");
      expect(result[0]?.isRestricted).toBe(true);
      expect(result[0]?.requiresPrescription).toBe(true);
    });

    it("sets hasCompleteData to false when unitPriceCents is null", async () => {
      const product = { ...baseServerProduct, currentPrice: null };
      const httpClient = createMockHttpClient([product], { data: [baseServerLot] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("no-price");
      expect(result[0]?.unitPriceCents).toBeNull();
      expect(result[0]?.hasCompleteData).toBe(false);
    });

    it("sets hasCompleteData to false when stock is zero", async () => {
      const httpClient = createMockHttpClient([baseServerProduct], {
        data: [{ ...baseServerLot, currentStock: 0 }],
      });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("zero-stock");
      expect(result[0]?.currentStock).toBe(0);
      expect(result[0]?.hasCompleteData).toBe(false);
    });

    it("sets hasCompleteData to false when no active lots exist", async () => {
      const httpClient = createMockHttpClient([baseServerProduct], { data: [] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("no-lots");
      expect(result[0]?.lotCode).toBe("");
      expect(result[0]?.hasCompleteData).toBe(false);
    });

    it("sets hasCompleteData to false when the product is inactive", async () => {
      const product = { ...baseServerProduct, isActive: false };
      const httpClient = createMockHttpClient([product], { data: [baseServerLot] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("inactive");
      expect(result[0]?.isActive).toBe(false);
      expect(result[0]?.hasCompleteData).toBe(false);
    });

    it("defaults taxPercentage to 19 when server tax data is null", async () => {
      const product = { ...baseServerProduct, currentTax: null };
      const httpClient = createMockHttpClient([product], { data: [baseServerLot] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("no-tax");
      expect(result[0]?.taxPercentage).toBe(19);
    });

    it("handles numeric price and tax rate strings", async () => {
      const product = {
        ...baseServerProduct,
        currentPrice: { price: "2500.50" },
        currentTax: { taxScheme: { rate: "0.05" } },
      };
      const httpClient = createMockHttpClient([product], { data: [baseServerLot] });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("string-values");
      expect(result[0]?.unitPriceCents).toBe(250050); // 2500.50 * 100
      expect(result[0]?.taxPercentage).toBe(5); // 0.05 * 100
    });

    it("maps multiple products returned by the server", async () => {
      const product2 = {
        ...baseServerProduct,
        id: "prod-002",
        commercialName: "Ibuprofeno 400mg",
      };
      const httpClient = createMockHttpClient([baseServerProduct, product2], {
        data: [baseServerLot],
      });
      const service = createHttpCatalogService({ httpClient });

      const result = await service.search("multiple");
      expect(result).toHaveLength(2);
      expect(result[0]?.name).toBe("Acetaminofén 500mg");
      expect(result[1]?.name).toBe("Ibuprofeno 400mg");
    });

    it("sends search query and page size as query parameters", async () => {
      const httpClient: HttpClient = {
        get: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 }),
      };
      const service = createHttpCatalogService({ httpClient });
      await service.search("ibuprofeno");

      expect(httpClient.get).toHaveBeenCalledWith("/catalog/products", {
        search: "ibuprofeno",
        page: 1,
        pageSize: 20,
      });
    });
  });
});
