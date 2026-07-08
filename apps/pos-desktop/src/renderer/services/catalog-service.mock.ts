/**
 * Mock catalog service for development and tests.
 *
 * Implements `CatalogService` using an in-memory product list. It exists so
 * the Sales/Cart screen can be reviewed without a running server, and so
 * unit tests do not depend on network state.
 *
 * To swap in the real implementation, replace the call to
 * `createMockCatalogService()` with `createHttpCatalogService({ httpClient })`
 * without changing `SalesTransaction`, the cart slice, or any selector.
 */
import { SaleType } from "@pharmacy/shared-types";
import {
  CatalogItem,
  CatalogService,
  isCatalogItemRestricted,
  isNearExpiry,
} from "./catalog-service";

const MOCK_PRODUCTS: CatalogItem[] = [
  {
    id: "p-001",
    name: "Acetaminofén 500mg",
    genericName: "Paracetamol",
    barcode: "7701234567890",
    invimaCertificate: "INVIMA-2019M-001234",
    saleType: SaleType.FREE_SALE,
    requiresPrescription: false,
    isRestricted: false,
    unitPriceCents: 6_200,
    taxPercentage: 19,
    currentStock: 45,
    minimumStock: 10,
    isActive: true,
    lotCode: "L24056",
    lotExpirationDate: "2026-08-30",
    hasCompleteData: true,
  },
  {
    id: "p-002",
    name: "Loratadina 10mg",
    genericName: "Loratadina",
    barcode: "7702345678901",
    invimaCertificate: "INVIMA-2020M-002345",
    saleType: SaleType.FREE_SALE,
    requiresPrescription: false,
    isRestricted: false,
    unitPriceCents: 8_500,
    taxPercentage: 19,
    currentStock: 45,
    minimumStock: 20,
    isActive: true,
    lotCode: "L24057",
    lotExpirationDate: "2027-03-01",
    hasCompleteData: true,
  },
  {
    id: "p-003",
    name: "Ibuprofeno 400mg",
    genericName: "Ibuprofeno",
    barcode: "7703456789012",
    invimaCertificate: "INVIMA-2018M-003456",
    saleType: SaleType.FREE_SALE,
    requiresPrescription: false,
    isRestricted: false,
    unitPriceCents: 6_200,
    taxPercentage: 19,
    currentStock: 3,
    minimumStock: 10,
    isActive: true,
    lotCode: "IB-2411",
    lotExpirationDate: "2026-07-15",
    hasCompleteData: true,
  },
  {
    id: "p-004",
    name: "Losartán 50mg",
    genericName: "Losartán potásico",
    barcode: "7704567890123",
    invimaCertificate: "INVIMA-2019M-004567",
    saleType: SaleType.PRESCRIPTION,
    requiresPrescription: true,
    isRestricted: false,
    unitPriceCents: 24_300,
    taxPercentage: 19,
    currentStock: 12,
    minimumStock: 8,
    isActive: true,
    lotCode: "LS-2409",
    lotExpirationDate: "2026-07-15",
    hasCompleteData: true,
  },
  {
    id: "p-005",
    name: "Clonazepam 2mg",
    genericName: "Clonazepam",
    barcode: "7705678901234",
    invimaCertificate: "RS-2024-001",
    saleType: SaleType.CONTROLLED_SUBSTANCE,
    requiresPrescription: true,
    isRestricted: true,
    unitPriceCents: 18_900,
    taxPercentage: 19,
    currentStock: 34,
    minimumStock: 5,
    isActive: true,
    lotCode: "CZ-2401",
    lotExpirationDate: "2027-01-10",
    hasCompleteData: true,
  },
  {
    id: "p-006",
    name: "Amoxicilina 500mg",
    genericName: "Amoxicilina",
    barcode: "7706789012345",
    invimaCertificate: "INVIMA-2021M-005678",
    saleType: SaleType.PRESCRIPTION,
    requiresPrescription: true,
    isRestricted: false,
    unitPriceCents: 12_350,
    taxPercentage: 19,
    currentStock: 8,
    minimumStock: 15,
    isActive: true,
    lotCode: "AM-2403",
    lotExpirationDate: "2026-07-22",
    hasCompleteData: true,
  },
  {
    id: "p-007",
    name: "Omeprazol 20mg",
    genericName: "Omeprazol",
    barcode: "7707890123456",
    invimaCertificate: "INVIMA-2017M-006789",
    saleType: SaleType.FREE_SALE,
    requiresPrescription: false,
    isRestricted: false,
    unitPriceCents: 8_950,
    taxPercentage: 19,
    currentStock: 20,
    minimumStock: 12,
    isActive: true,
    lotCode: "OM-2401",
    lotExpirationDate: "2026-09-10",
    hasCompleteData: true,
  },
  {
    id: "p-008",
    name: "Vitamina C 500mg",
    genericName: "Ácido ascórbico",
    barcode: "7708901234567",
    invimaCertificate: "INVIMA-2022M-007890",
    saleType: SaleType.FREE_SALE,
    requiresPrescription: false,
    isRestricted: false,
    unitPriceCents: 1_500,
    taxPercentage: 19,
    currentStock: 100,
    minimumStock: 20,
    isActive: true,
    lotCode: "VC-2401",
    lotExpirationDate: "2027-02-28",
    hasCompleteData: true,
  },
  {
    id: "p-009",
    name: "Insulina glargina 100UI/ml",
    genericName: "Insulina glargina",
    barcode: "7709012345678",
    invimaCertificate: "INVIMA-2020M-008901",
    saleType: SaleType.PRESCRIPTION,
    requiresPrescription: true,
    isRestricted: false,
    unitPriceCents: 123_456,
    taxPercentage: 19,
    currentStock: 5,
    minimumStock: 3,
    isActive: true,
    lotCode: "IN-2401",
    lotExpirationDate: "2027-04-15",
    hasCompleteData: true,
  },
];

export const createMockCatalogService = (): CatalogService => ({
  search: async (query: string): Promise<CatalogItem[]> => {
    const normalized = query.trim().toLowerCase();

    if (normalized.length === 0) {
      return [];
    }

    const results = MOCK_PRODUCTS.filter((product) => {
      const haystack = [
        product.name,
        product.genericName,
        product.barcode,
        product.lotCode,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });

    // Simulate a deterministic, very small async boundary so the UI code
    // already handles loading states the same way it will with a real DB call.
    return new Promise((resolve) => {
      setTimeout(() => resolve(results), 0);
    });
  },
});

/**
 * Convenience export so tests and the token-reference page can verify
 * mock data without calling the service.
 */
export const MOCK_CATALOG_ITEMS = MOCK_PRODUCTS;
export { isCatalogItemRestricted, isNearExpiry };
