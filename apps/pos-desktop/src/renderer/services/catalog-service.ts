/**
 * Catalog service interface.
 *
 * This is the boundary between the SalesTransaction UI and product data.
 * The component and the Redux slice depend only on this interface, never on
 * the concrete data source. Replacing the mock implementation below with a
 * Tauri-backed SQLite implementation is a drop-in change:
 *
 *   const catalogService = createTauriCatalogService();
 *
 * The returned object must simply satisfy the `CatalogService` interface.
 */
import { Product, SaleType } from "@pharmacy/shared-types";

/**
 * Local catalog item returned by the service.
 *
 * Extends the shared Product type with POS-specific lot information that the
 * shared package does not yet model. When `InventoryLot` is added to
 * `@pharmacy/shared-types`, this local type should be replaced by it.
 */
export interface CatalogItem extends Product {
  lotCode: string;
  lotExpirationDate: string;
  stock: number;
}

export interface CatalogService {
  /**
   * Search products by name, generic name, barcode, or lot code.
   * Returns a promise so the UI can treat local mocks and remote calls identically.
   */
  search(query: string): Promise<CatalogItem[]>;
}

const NEAR_EXPIRY_DAYS = 30;

/**
 * Convert a price string (COP, no decimals) into an integer number of cents.
 */
export const parsePriceToCents = (price: string): number => {
  const normalized = price.replace(/[^\d]/g, "");
  const value = Number.parseInt(normalized, 10);
  return Number.isNaN(value) ? 0 : value;
};

/**
 * Determine whether a product requires the restricted-sale confirmation step.
 */
export const isCatalogItemRestricted = (item: CatalogItem): boolean =>
  item.saleType === SaleType.CONTROLLED_SUBSTANCE || item.requiresPrescription;

/**
 * Determine whether a lot expires within the near-expiry window.
 */
export const isNearExpiry = (
  lotExpirationDate: string,
  referenceDate = new Date(),
): boolean => {
  const expiry = new Date(lotExpirationDate);
  const diffMs = expiry.getTime() - referenceDate.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return diffDays >= 0 && diffDays <= NEAR_EXPIRY_DAYS;
};

/**
 * Determine whether stock is below the configured minimum threshold.
 */
export const isLowStock = (item: CatalogItem): boolean =>
  item.stock <= item.minimumStock;
