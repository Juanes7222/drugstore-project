/**
 * Catalog service interface.
 *
 * This is the boundary between the SalesTransaction UI and product data.
 * The component and the Redux slice depend only on this interface, never on
 * the concrete data source. The real HTTP implementation is in
 * `catalog-service.http.ts`; the mock implementation remains available for
 * offline development and tests in `catalog-service.mock.ts`.
 *
 * The `CatalogItem` shape is intentionally POS-specific: it contains exactly
 * the fields the cart/totals code needs, mapped from whatever the server
 * returns. If the server's response shape changes, only the mapper changes.
 */
import { SaleType } from "@pharmacy/shared-types";

const NEAR_EXPIRY_DAYS = 30;

export interface CatalogItem {
  id: string;
  name: string;
  genericName: string;
  barcode: string;
  invimaCertificate: string | null;
  saleType: SaleType;
  requiresPrescription: boolean;
  isRestricted: boolean;
  unitPriceCents: number | null;
  taxPercentage: number;
  currentStock: number;
  minimumStock: number;
  isActive: boolean;
  lotCode: string;
  lotExpirationDate: string;
  /** True only when all POS-critical fields (price, tax, stock, lot) are present. */
  hasCompleteData: boolean;
}

export interface CatalogService {
  /**
   * Search products by name, generic name, barcode, or lot code.
   * Returns a promise so the UI can treat local mocks and remote calls identically.
   */
  search(query: string): Promise<CatalogItem[]>;
}

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
  item.currentStock <= item.minimumStock;
