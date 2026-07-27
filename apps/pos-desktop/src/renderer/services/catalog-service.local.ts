/**
 * Local-first catalog service implementation.
 *
 * Reads product data from the local PGlite database (the POS's authoritative
 * local cache) rather than the remote server. This is the correct behaviour
 * for an offline-first POS:
 *
 *   - The local DB is populated by `CatalogSyncService.pullCatalog()` from
 *     the server AND by direct local edits via `ProductService` (price/tax
 *     changes, new products, soft-deletes). Those edits are enqueued for
 *     push in the SyncQueue and reach the server asynchronously.
 *
 *   - The POS sales search must read what the cashier sees locally: the
 *     price they typed, the tax scheme they configured, the product they
 *     created. If a stale pull-sync silently overwrites a local edit with
 *     older server data, the cashier sees the wrong number at checkout —
 *     exactly the bug this service exists to prevent.
 *
 *   - When the local DB has no data for a query, this service does NOT
 *     silently fall back to the HTTP service. Falling back would re-introduce
 *     the server-as-primary behaviour the offline-first architecture forbids.
 *     The catalog-sync pipeline is the only place that should pull from
 *     the server; product discovery in the POS UI should never do it.
 */
import { type PrismaClient, LotState } from '@pharmacy/database/local';
import { SaleType } from '@pharmacy/shared-types';
import { type CatalogItem, type CatalogService } from './catalog-service';

const SEARCH_LIMIT = 20;

/**
 * Convert a Prisma Decimal (stored as decimal fraction, e.g. 0.19 for 19%)
 * to an integer percentage (e.g. 19). Returns 0 if the rate is missing,
 * matching the behaviour expected by the cart selector: missing tax data
 * must not be silently treated as 19% (see `selectTaxCents`).
 */
const rateToPercentage = (rate: unknown): number => {
  if (rate === null || rate === undefined) return 0;
  const numeric =
    typeof rate === 'string' ? Number.parseFloat(rate) : Number(rate);
  if (Number.isNaN(numeric)) return 0;
  return Math.round(numeric * 100);
};

/**
 * Convert a Prisma Decimal price to integer cents. Returns null if the price
 * is missing so the caller can mark `hasCompleteData = false`.
 */
const priceToCents = (price: unknown): number | null => {
  if (price === null || price === undefined) return null;
  const numeric =
    typeof price === 'string' ? Number.parseFloat(price) : Number(price);
  if (Number.isNaN(numeric)) return null;
  return Math.round(numeric * 100);
};

export interface LocalCatalogServiceOptions {
  /**
   * Resolver for the Prisma client. Called on every `search()` because the
   * PGlite singleton initializes asynchronously on first access; subsequent
   * calls return instantly.
   */
  prismaResolver: () => Promise<PrismaClient | null>;
}

interface LocalLotRow {
  batchNumber: string;
  expirationDate: Date | string;
  currentStock: number;
  state: LotState;
}

interface LocalProductRow {
  id: string;
  commercialName: string;
  genericName: string;
  saleType: SaleType;
  minimumStock: number;
  isActive: boolean;
  invimaRegistry: string | null;
  barcodes: Array<{ barcode: string; isPrimary: boolean }>;
  priceHistories: Array<{ price: unknown }>;
  taxHistories: Array<{ taxScheme: { rate: unknown } | null }>;
  lots: LocalLotRow[];
}

const mapLocalProductToCatalogItem = (
  product: LocalProductRow,
): CatalogItem => {
  const activeLots = product.lots.filter((lot) => lot.state === LotState.ACTIVE);

  const currentStock = activeLots.reduce(
    (sum, lot) => sum + (lot.currentStock ?? 0),
    0,
  );

  const nearestLot = activeLots
    .slice()
    .sort(
      (a, b) =>
        new Date(a.expirationDate).getTime() -
        new Date(b.expirationDate).getTime(),
    )[0];

  const unitPriceCents = priceToCents(product.priceHistories[0]?.price);
  const taxPercentage = rateToPercentage(
    product.taxHistories[0]?.taxScheme?.rate,
  );

  const requiresPrescription = product.saleType !== SaleType.FREE_SALE;
  const isRestricted = product.saleType === SaleType.CONTROLLED_SUBSTANCE;

  const hasCompleteData =
    unitPriceCents !== null &&
    currentStock > 0 &&
    nearestLot !== undefined &&
    product.isActive !== false;

  const primaryBarcode =
    product.barcodes.find((bc) => bc.isPrimary)?.barcode ??
    product.barcodes[0]?.barcode ??
    '';

  return {
    id: product.id,
    name: product.commercialName,
    genericName: product.genericName,
    barcode: primaryBarcode,
    invimaCertificate: product.invimaRegistry,
    saleType: product.saleType,
    requiresPrescription,
    isRestricted,
    unitPriceCents,
    taxPercentage,
    currentStock,
    minimumStock: product.minimumStock ?? 0,
    isActive: product.isActive ?? true,
    lotCode: nearestLot?.batchNumber ?? '',
    lotExpirationDate:
      nearestLot?.expirationDate instanceof Date
        ? nearestLot.expirationDate.toISOString()
        : new Date().toISOString(),
    hasCompleteData,
  };
};

export const createLocalCatalogService = (
  options: LocalCatalogServiceOptions,
): CatalogService => ({
  search: async (query: string): Promise<CatalogItem[]> => {
    const prisma = await options.prismaResolver();
    if (!prisma) return [];

    const trimmed = query.trim();
    if (trimmed.length === 0) return [];

    const q = trimmed.toLowerCase();

    const products = await prisma.product.findMany({
      where: {
        isActive: true,
        OR: [
          { commercialName: { contains: q, mode: 'insensitive' } },
          { genericName: { contains: q, mode: 'insensitive' } },
          { activePrinciple: { contains: q, mode: 'insensitive' } },
          { internalCode: { contains: q, mode: 'insensitive' } },
          { barcodes: { some: { barcode: { contains: q, mode: 'insensitive' } } } },
        ],
      },
      include: {
        barcodes: { select: { barcode: true, isPrimary: true } },
        priceHistories: {
          where: { effectiveTo: null },
          select: { price: true },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        taxHistories: {
          where: { effectiveTo: null },
          select: { taxScheme: { select: { rate: true } } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        lots: {
          where: { state: LotState.ACTIVE },
          select: {
            batchNumber: true,
            expirationDate: true,
            currentStock: true,
            state: true,
          },
        },
      },
      take: SEARCH_LIMIT,
    });

    return products.map((product) =>
      mapLocalProductToCatalogItem(product as unknown as LocalProductRow),
    );
  },
});
