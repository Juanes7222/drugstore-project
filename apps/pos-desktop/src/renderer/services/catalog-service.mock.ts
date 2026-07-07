/**
 * Mock catalog service for Phase 2.
 *
 * Implements `CatalogService` using an in-memory product list. It exists so
 * the Sales/Cart screen can be built and reviewed before the Tauri-backed
 * SQLite catalog service is implemented.
 *
 * To swap in the real implementation, replace the call to
 * `createMockCatalogService()` with `createTauriCatalogService()` (or similar)
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
    currentStock: 45,
    minimumStock: 10,
    purchasePrice: "3200",
    sellingPrice: "6200",
    taxPercentage: "19",
    isActive: true,
    expirationDate: "2026-08-30",
    createdAt: "2024-01-15T10:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    lotCode: "L24056",
    lotExpirationDate: "2026-08-30",
    stock: 45,
  },
  {
    id: "p-002",
    name: "Loratadina 10mg",
    genericName: "Loratadina",
    barcode: "7702345678901",
    invimaCertificate: "INVIMA-2020M-002345",
    saleType: SaleType.FREE_SALE,
    requiresPrescription: false,
    currentStock: 45,
    minimumStock: 20,
    purchasePrice: "4100",
    sellingPrice: "8500",
    taxPercentage: "19",
    isActive: true,
    expirationDate: "2027-03-01",
    createdAt: "2024-02-10T10:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    lotCode: "L24057",
    lotExpirationDate: "2027-03-01",
    stock: 45,
  },
  {
    id: "p-003",
    name: "Ibuprofeno 400mg",
    genericName: "Ibuprofeno",
    barcode: "7703456789012",
    invimaCertificate: "INVIMA-2018M-003456",
    saleType: SaleType.FREE_SALE,
    requiresPrescription: false,
    currentStock: 3,
    minimumStock: 10,
    purchasePrice: "3100",
    sellingPrice: "6200",
    taxPercentage: "19",
    isActive: true,
    expirationDate: "2026-07-15",
    createdAt: "2024-03-05T10:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    lotCode: "IB-2411",
    lotExpirationDate: "2026-07-15",
    stock: 3,
  },
  {
    id: "p-004",
    name: "Losartán 50mg",
    genericName: "Losartán potásico",
    barcode: "7704567890123",
    invimaCertificate: "INVIMA-2019M-004567",
    saleType: SaleType.PRESCRIPTION,
    requiresPrescription: true,
    currentStock: 12,
    minimumStock: 8,
    purchasePrice: "14200",
    sellingPrice: "24300",
    taxPercentage: "19",
    isActive: true,
    expirationDate: "2026-07-15",
    createdAt: "2024-04-20T10:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    lotCode: "LS-2409",
    lotExpirationDate: "2026-07-15",
    stock: 12,
  },
  {
    id: "p-005",
    name: "Clonazepam 2mg",
    genericName: "Clonazepam",
    barcode: "7705678901234",
    invimaCertificate: "RS-2024-001",
    saleType: SaleType.CONTROLLED_SUBSTANCE,
    requiresPrescription: true,
    currentStock: 34,
    minimumStock: 5,
    purchasePrice: "11200",
    sellingPrice: "18900",
    taxPercentage: "19",
    isActive: true,
    expirationDate: "2027-01-10",
    createdAt: "2024-05-12T10:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    lotCode: "CZ-2401",
    lotExpirationDate: "2027-01-10",
    stock: 34,
  },
  {
    id: "p-006",
    name: "Amoxicilina 500mg",
    genericName: "Amoxicilina",
    barcode: "7706789012345",
    invimaCertificate: "INVIMA-2021M-005678",
    saleType: SaleType.PRESCRIPTION,
    requiresPrescription: true,
    currentStock: 8,
    minimumStock: 15,
    purchasePrice: "6900",
    sellingPrice: "12350",
    taxPercentage: "19",
    isActive: true,
    expirationDate: "2026-07-22",
    createdAt: "2024-06-01T10:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    lotCode: "AM-2403",
    lotExpirationDate: "2026-07-22",
    stock: 8,
  },
  {
    id: "p-007",
    name: "Omeprazol 20mg",
    genericName: "Omeprazol",
    barcode: "7707890123456",
    invimaCertificate: "INVIMA-2017M-006789",
    saleType: SaleType.FREE_SALE,
    requiresPrescription: false,
    currentStock: 20,
    minimumStock: 12,
    purchasePrice: "4500",
    sellingPrice: "8950",
    taxPercentage: "19",
    isActive: true,
    expirationDate: "2026-09-10",
    createdAt: "2024-07-08T10:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    lotCode: "OM-2401",
    lotExpirationDate: "2026-09-10",
    stock: 20,
  },
  {
    id: "p-008",
    name: "Vitamina C 500mg",
    genericName: "Ácido ascórbico",
    barcode: "7708901234567",
    invimaCertificate: "INVIMA-2022M-007890",
    saleType: SaleType.FREE_SALE,
    requiresPrescription: false,
    currentStock: 100,
    minimumStock: 20,
    purchasePrice: "800",
    sellingPrice: "1500",
    taxPercentage: "19",
    isActive: true,
    expirationDate: "2027-02-28",
    createdAt: "2024-08-15T10:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    lotCode: "VC-2401",
    lotExpirationDate: "2027-02-28",
    stock: 100,
  },
  {
    id: "p-009",
    name: "Insulina glargina 100UI/ml",
    genericName: "Insulina glargina",
    barcode: "7709012345678",
    invimaCertificate: "INVIMA-2020M-008901",
    saleType: SaleType.PRESCRIPTION,
    requiresPrescription: true,
    currentStock: 5,
    minimumStock: 3,
    purchasePrice: "78000",
    sellingPrice: "123456",
    taxPercentage: "19",
    isActive: true,
    expirationDate: "2027-04-15",
    createdAt: "2024-09-20T10:00:00Z",
    updatedAt: "2026-07-01T08:00:00Z",
    lotCode: "IN-2401",
    lotExpirationDate: "2027-04-15",
    stock: 5,
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
