/**
 * Real HTTP catalog service implementation.
 *
 * Reads from the NestJS server:
 *   - GET /catalog/products?search=...&pageSize=...
 *   - GET /inventory-lots/lots?productId=...&state=ACTIVE&pageSize=...
 *
 * Maps the server's product/lot shapes into the POS `CatalogItem` shape. The
 * mapping is defensive: if a field the POS needs is missing, `hasCompleteData`
 * becomes false and the UI disables the add-to-cart action for that result.
 */
import { SaleType } from "@pharmacy/shared-types";
import { HttpClient } from "./http-client";
import { CatalogItem, CatalogService } from "./catalog-service";

interface ServerCatalogResponse {
  items: ServerProduct[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface ServerProduct {
  id: string;
  commercialName: string;
  genericName: string;
  saleType: SaleType;
  minimumStock: number;
  isActive: boolean;
  invimaRegistry: string | null;
  barcodes?: Array<{ barcode: string; isPrimary: boolean }> | null;
  currentPrice?: { price: string | number } | null;
  currentTax?: { taxScheme?: { rate: string | number } | null } | null;
}

interface ServerLot {
  id: string;
  batchNumber: string;
  expirationDate: string;
  currentStock: number;
  state: string;
}

interface ServerLotsResponse {
  data: ServerLot[];
  total: number;
  page: number;
  pageSize: number;
}

const DEFAULT_TAX_PERCENTAGE = 19;
const SEARCH_PAGE_SIZE = 20;
const LOTS_PAGE_SIZE = 100;

const toCents = (price: string | number | undefined): number | null => {
  if (price === undefined || price === null) {
    return null;
  }

  const numeric =
    typeof price === "string" ? Number.parseFloat(price) : price;

  if (Number.isNaN(numeric)) {
    return null;
  }

  return Math.round(numeric * 100);
};

const toTaxPercentage = (
  rate: string | number | undefined,
): number | null => {
  if (rate === undefined || rate === null) {
    return null;
  }

  const numeric = typeof rate === "string" ? Number.parseFloat(rate) : rate;

  if (Number.isNaN(numeric)) {
    return null;
  }

  return Math.round(numeric * 100);
};

const resolveBarcode = (product: ServerProduct): string => {
  const primary = product.barcodes?.find((barcode) => barcode.isPrimary);
  return primary?.barcode ?? product.barcodes?.[0]?.barcode ?? "";
};

const fetchActiveLots = async (
  httpClient: HttpClient,
  productId: string,
): Promise<ServerLot[]> => {
  const response = await httpClient.get<ServerLotsResponse>(
    "/inventory-lots/lots",
    {
      productId,
      state: "ACTIVE",
      page: 1,
      pageSize: LOTS_PAGE_SIZE,
    },
  );

  return response.data ?? [];
};

const mapServerProductToCatalogItem = async (
  httpClient: HttpClient,
  product: ServerProduct,
): Promise<CatalogItem> => {
  const lots = await fetchActiveLots(httpClient, product.id);

  const currentStock = lots.reduce(
    (sum, lot) => sum + (lot.currentStock ?? 0),
    0,
  );

  const nearestLot = lots
    .slice()
    .sort(
      (a, b) =>
        new Date(a.expirationDate).getTime() -
        new Date(b.expirationDate).getTime(),
    )[0];

  const unitPriceCents = toCents(product.currentPrice?.price);
  const taxPercentage =
    toTaxPercentage(product.currentTax?.taxScheme?.rate) ??
    DEFAULT_TAX_PERCENTAGE;

  const requiresPrescription = product.saleType !== SaleType.FREE_SALE;
  const isRestricted = product.saleType === SaleType.CONTROLLED_SUBSTANCE;

  const hasCompleteData =
    unitPriceCents !== null &&
    currentStock > 0 &&
    nearestLot !== undefined &&
    product.isActive !== false;

  return {
    id: product.id,
    name: product.commercialName,
    genericName: product.genericName,
    barcode: resolveBarcode(product),
    invimaCertificate: product.invimaRegistry,
    saleType: product.saleType,
    requiresPrescription,
    isRestricted,
    unitPriceCents,
    taxPercentage,
    currentStock,
    minimumStock: product.minimumStock ?? 0,
    isActive: product.isActive ?? true,
    lotCode: nearestLot?.batchNumber ?? "",
    lotExpirationDate: nearestLot?.expirationDate ?? new Date().toISOString(),
    hasCompleteData,
  };
};

export interface HttpCatalogServiceOptions {
  httpClient: HttpClient;
}

export const createHttpCatalogService = (
  options: HttpCatalogServiceOptions,
): CatalogService => ({
  search: async (query: string): Promise<CatalogItem[]> => {
    const trimmedQuery = query.trim();

    if (trimmedQuery.length === 0) {
      return [];
    }

    const response = await options.httpClient.get<ServerCatalogResponse>(
      "/catalog/products",
      {
        search: trimmedQuery,
        page: 1,
        pageSize: SEARCH_PAGE_SIZE,
      },
    );

    const products = response.items ?? [];

    return Promise.all(
      products.map((product) =>
        mapServerProductToCatalogItem(options.httpClient, product),
      ),
    );
  },
});
