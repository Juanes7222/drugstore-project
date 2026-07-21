/**
 * Read-only catalog cache synchronizer.
 *
 * Pulls the server's product, category, and pharmaceutical-form data into
 * local PGlite tables so the POS can search and display the catalog while
 * offline, without issuing live HTTP requests on every keystroke.
 *
 * ## Shape
 * This file is the reference pattern for all other pull-based sync services
 * in this application (`LotSyncService` follows it exactly).  Every such
 * service exposes a single `pullXxx()` method, a factory function, and
 * records its completion in the shared `sync-metadata` store.
 *
 * ## What it caches
 * - Products (including their barcodes, active price history, and active tax history)
 * - Categories
 * - Pharmaceutical forms
 * - Tax schemes
 *
 * Price and tax histories are synced from the server's `currentPrice` and
 * `currentTax` fields so the POS can display prices and taxes while offline.
 */

import { PrismaClient, Prisma } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import {
  setCatalogLastSyncedAt,
} from '../../common/sync-metadata';

// ---------------------------------------------------------------------------
// HTTP client abstraction (same pattern as auth.service.ts)
// ---------------------------------------------------------------------------

export interface SyncHttpClient {
  get<T>(url: string, headers?: Record<string, string>): Promise<T>;
}

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new CatalogSyncHttpError(url, response.status, await response.text());
    }
    return response.json() as Promise<T>;
  },
};

// ---------------------------------------------------------------------------
// Config & factory
// ---------------------------------------------------------------------------

export interface CatalogSyncConfig {
  /** Server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
  /** Optional override of the HTTP client (for testing). */
  httpClient?: SyncHttpClient;
  /** Optional auth token for protected endpoints. */
  accessToken?: string;
}

export const createCatalogSyncService = (
  prisma: PrismaClient,
  config: CatalogSyncConfig,
): CatalogSyncService => {
  return new CatalogSyncService(prisma, config);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class CatalogSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: CatalogSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Pull the full product catalog from the server into the local database.
   *
   * - Fetches categories, pharmaceutical forms, tax schemes, and paginated
   *   products.
   * - Upserts every row inside a single local transaction (all-or-nothing).
   * - Records `catalogLastSyncedAt` on success.
   *
   * Safe to call when offline — returns early without throwing.
   * Safe to call concurrently — conflicts are handled by the single
   * transaction wrapping all upserts.
   *
   * Tax schemes are seeded in the local database at init time
   * (`local-database.ts`) so the app works fully offline.  This sync step
   * overwrites seed rows with the server's authoritative data (matched by
   * id).  If the server endpoint is unreachable the seed data survives.
   */
  async pullCatalog(): Promise<void> {
    if (!isOnline()) return;

    const authHeaders = this.buildAuthHeaders();

    // Fetch reference data (categories + forms + tax schemes) in parallel
    const [categories, pharmaceuticalForms, taxSchemes] = await Promise.all([
      this.http.get<unknown[]>(`${this.baseUrl}/catalog/categories`, authHeaders),
      this.http.get<unknown[]>(`${this.baseUrl}/catalog/pharmaceutical-forms`, authHeaders),
      this.fetchTaxSchemes(authHeaders),
    ]);

    // Fetch all products — paginate through the server
    const products = await this.fetchAllProducts(authHeaders);

    // Upsert everything inside one local transaction
    await this.prisma.$transaction(async (tx) => {
      // Upsert categories
      for (const cat of categories as CategoryRow[]) {
        await tx.category.upsert({
          where: { id: cat.id },
          create: mapCategoryForCreate(cat),
          update: mapCategoryForUpdate(cat),
        });
      }

      // Upsert pharmaceutical forms
      for (const form of pharmaceuticalForms as PharmaceuticalFormRow[]) {
        await tx.pharmaceuticalForm.upsert({
          where: { id: form.id },
          create: mapPharmaceuticalFormForCreate(form),
          update: mapPharmaceuticalFormForUpdate(form),
        });
      }

      // Upsert tax schemes
      for (const ts of taxSchemes as TaxSchemeRow[]) {
        await tx.taxScheme.upsert({
          where: { id: ts.id },
          create: mapTaxSchemeForCreate(ts),
          update: mapTaxSchemeForUpdate(ts),
        });
      }

      // Upsert products and their barcodes
      for (const prod of products as ProductRow[]) {
        await tx.product.upsert({
          where: { id: prod.id },
          create: mapProductForCreate(prod),
          update: mapProductForUpdate(prod),
        });

        // Sync barcodes: delete all and re-insert for simplicity, since
        // barcodes are few per product and this runs infrequently.
        if (prod.barcodes && prod.barcodes.length > 0) {
          await tx.productBarcode.deleteMany({ where: { productId: prod.id } });
            for (const bc of prod.barcodes) {
            await tx.productBarcode.create({
              data: {
                id: bc.id,
                productId: prod.id,
                barcode: bc.barcode,
                barcodeType: bc.barcodeType as any,
                isPrimary: bc.isPrimary ?? false,
              },
            });
          }
        }

        // Sync active price history (two-step: create history, then point to it)
        if (prod.currentPrice) {
          await tx.productPriceHistory.upsert({
            where: { id: prod.currentPrice.id },
            create: mapPriceHistoryForCreate(prod.currentPrice),
            update: mapPriceHistoryForUpdate(prod.currentPrice),
          });
          await tx.product.update({
            where: { id: prod.id },
            data: { currentPriceId: prod.currentPrice.id },
          });
        }

        // Sync active tax history (two-step: create history, then point to it)
        // Assumes the referenced TaxScheme was already upserted earlier in
        // this same transaction (from the taxSchemes fetch).  If fetchTaxSchemes
        // returned empty but a product references a scheme, the FK constraint
        // will cause the transaction to roll back — which is the correct
        // outcome for inconsistent server data.
        if (prod.currentTax) {
          await tx.productTaxHistory.upsert({
            where: { id: prod.currentTax.id },
            create: mapTaxHistoryForCreate(prod.currentTax),
            update: mapTaxHistoryForUpdate(prod.currentTax),
          });
          await tx.product.update({
            where: { id: prod.id },
            data: { currentTaxHistoryId: prod.currentTax.id },
          });
        }
      }
    });

    setCatalogLastSyncedAt(new Date().toISOString());
  }

  /**
   * Pull tax schemes from the server.
   *
   * Fetches `GET /catalog/tax-schemes` and upserts every row locally.
   * If the endpoint is unreachable or returns no data, no rows are written
   * — the local seed data (inserted at database init time) stays in place.
   */
  async pullTaxSchemes(): Promise<void> {
    if (!isOnline()) return;

    const authHeaders = this.buildAuthHeaders();
    const schemes = await this.fetchTaxSchemes(authHeaders);

    if (schemes.length === 0) return;

    await this.prisma.$transaction(async (tx) => {
      for (const ts of schemes as TaxSchemeRow[]) {
        await tx.taxScheme.upsert({
          where: { id: ts.id },
          create: mapTaxSchemeForCreate(ts),
          update: mapTaxSchemeForUpdate(ts),
        });
      }
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildAuthHeaders(): Record<string, string> {
    if (this.accessToken) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }
    return {};
  }

  /**
   * Fetch tax schemes from the server.
   * Returns an empty array when the endpoint is unreachable or returns
   * a non-OK status — no fallback seed data.
   */
  private async fetchTaxSchemes(
    authHeaders: Record<string, string>,
  ): Promise<unknown[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/catalog/tax-schemes`,
        { headers: authHeaders },
      );
      if (response.ok) {
        return (await response.json()) as unknown[];
      }
    } catch {
      // Server unreachable — return empty; table keeps last known state.
    }
    return [];
  }

  /**
   * Fetch all products from the paginated server endpoint.
   * Uses `pageSize: 200` to minimise round-trips.
   */
  private async fetchAllProducts(authHeaders: Record<string, string>): Promise<unknown[]> {
    const pageSize = 200;
    let page = 1;
    let totalPages = 1;
    const all: unknown[] = [];

    while (page <= totalPages) {
      const response = await this.http.get<{
        items: unknown[];
        total: number;
        page: number;
        pageSize: number;
        totalPages: number;
      }>(
        `${this.baseUrl}/catalog/products?page=${page}&pageSize=${pageSize}`,
        authHeaders,
      );

      all.push(...response.items);
      totalPages = response.totalPages;
      page++;
    }

    return all;
  }
}

// ---------------------------------------------------------------------------
// Local error
// ---------------------------------------------------------------------------

export class CatalogSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(url: string, statusCode: number, responseBody: string) {
    super(`Catalog sync HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'CatalogSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ---------------------------------------------------------------------------
// Row-shape types (server response → local upsert mapping)
// ---------------------------------------------------------------------------

/** Minimal shape the server's GET /catalog/categories returns. */
interface CategoryRow {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Minimal shape the server's GET /catalog/pharmaceutical-forms returns. */
interface PharmaceuticalFormRow {
  id: string;
  name: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** Minimal shape the server's GET /catalog/products returns per item. */
interface ProductRow {
  id: string;
  internalCode: string;
  commercialName: string;
  genericName: string;
  activePrinciple: string;
  concentration?: string | null;
  concentrationUnit?: string | null;
  laboratory: string;
  saleType: string;
  minimumStock: number;
  isActive: boolean;
  discontinuationReason?: string | null;
  invimaRegistry?: string | null;
  atcCode?: string | null;
  therapeuticIndication?: string | null;
  storageConditions?: string | null;
  internalNotes?: string | null;
  categoryId?: string | null;
  pharmaceuticalFormId?: string | null;
  createdAt: string;
  updatedAt: string;
  createdById: string;
  barcodes?: BarcodeRow[];
  /** Active price history record from the server (or null). */
  currentPrice: PriceHistoryRow | null;
  /** Active tax history record from the server (or null). */
  currentTax: TaxHistoryRow | null;
}

interface BarcodeRow {
  id: string;
  barcode: string;
  barcodeType: string;
  isPrimary: boolean;
}

/** Minimal shape of the server's `currentPrice` embedded in each product. */
interface PriceHistoryRow {
  id: string;
  productId: string;
  price: string | number;
  effectiveFrom: string;
  effectiveTo: string | null;
  changedById: string;
  changedAt: string;
  changeReason: string | null;
  previousPriceHistoryId: string | null;
}

/** Minimal shape of the server's `currentTax` embedded in each product. */
interface TaxHistoryRow {
  id: string;
  productId: string;
  taxSchemeId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  changedById: string;
  changedAt: string;
  changeReason: string | null;
  previousTaxHistoryId: string | null;
}

/** Minimal shape for tax scheme rows returned by the server. */
interface TaxSchemeRow {
  id: string;
  code: string;
  name: string;
  taxType: string;
  rate: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdById: string;
}

// Mapping helpers — keep Prisma create/update args separate so a schema
// change on one side does not silently break the other.

/* eslint-disable @typescript-eslint/no-explicit-any */

const mapCategoryForCreate = (cat: CategoryRow): any => ({
  id: cat.id,
  name: cat.name,
  sortOrder: cat.sortOrder,
});

const mapCategoryForUpdate = (cat: CategoryRow): any => ({
  name: cat.name,
  sortOrder: cat.sortOrder,
});

const mapPharmaceuticalFormForCreate = (form: PharmaceuticalFormRow): any => ({
  id: form.id,
  name: form.name,
  sortOrder: form.sortOrder,
});

const mapPharmaceuticalFormForUpdate = (form: PharmaceuticalFormRow): any => ({
  name: form.name,
  sortOrder: form.sortOrder,
});

const mapTaxSchemeForCreate = (ts: TaxSchemeRow): any => ({
  id: ts.id,
  code: ts.code,
  name: ts.name,
  taxType: ts.taxType,
  rate: ts.rate,
  effectiveFrom: new Date(ts.effectiveFrom),
  effectiveTo: ts.effectiveTo ? new Date(ts.effectiveTo) : null,
  isActive: ts.isActive,
  createdAt: new Date(ts.createdAt),
  updatedAt: new Date(ts.updatedAt),
  createdById: ts.createdById,
});

const mapTaxSchemeForUpdate = (ts: TaxSchemeRow): any => ({
  code: ts.code,
  name: ts.name,
  taxType: ts.taxType,
  rate: ts.rate,
  effectiveFrom: new Date(ts.effectiveFrom),
  effectiveTo: ts.effectiveTo ? new Date(ts.effectiveTo) : null,
  isActive: ts.isActive,
  updatedAt: new Date(ts.updatedAt),
});

const mapPriceHistoryForCreate = (price: PriceHistoryRow): any => ({
  id: price.id,
  productId: price.productId,
  price: new Prisma.Decimal(price.price),
  effectiveFrom: new Date(price.effectiveFrom),
  effectiveTo: price.effectiveTo ? new Date(price.effectiveTo) : null,
  changedById: price.changedById,
  changedAt: new Date(price.changedAt),
  changeReason: price.changeReason,
  previousPriceHistoryId: price.previousPriceHistoryId,
});

const mapPriceHistoryForUpdate = (price: PriceHistoryRow): any => ({
  price: new Prisma.Decimal(price.price),
  effectiveFrom: new Date(price.effectiveFrom),
  effectiveTo: price.effectiveTo ? new Date(price.effectiveTo) : null,
  changedAt: new Date(price.changedAt),
  changeReason: price.changeReason,
});

const mapTaxHistoryForCreate = (tax: TaxHistoryRow): any => ({
  id: tax.id,
  productId: tax.productId,
  taxSchemeId: tax.taxSchemeId,
  effectiveFrom: new Date(tax.effectiveFrom),
  effectiveTo: tax.effectiveTo ? new Date(tax.effectiveTo) : null,
  changedById: tax.changedById,
  changedAt: new Date(tax.changedAt),
  changeReason: tax.changeReason,
  previousTaxHistoryId: tax.previousTaxHistoryId,
});

const mapTaxHistoryForUpdate = (tax: TaxHistoryRow): any => ({
  taxSchemeId: tax.taxSchemeId,
  effectiveFrom: new Date(tax.effectiveFrom),
  effectiveTo: tax.effectiveTo ? new Date(tax.effectiveTo) : null,
  changedAt: new Date(tax.changedAt),
  changeReason: tax.changeReason,
});

const mapProductForCreate = (prod: ProductRow): any => ({
  id: prod.id,
  internalCode: prod.internalCode,
  commercialName: prod.commercialName,
  genericName: prod.genericName,
  activePrinciple: prod.activePrinciple,
  concentration: prod.concentration ?? null,
  concentrationUnit: prod.concentrationUnit ?? null,
  laboratory: prod.laboratory,
  saleType: prod.saleType,
  minimumStock: prod.minimumStock,
  isActive: prod.isActive,
  discontinuationReason: prod.discontinuationReason ?? null,
  invimaRegistry: prod.invimaRegistry ?? null,
  atcCode: prod.atcCode ?? null,
  therapeuticIndication: prod.therapeuticIndication ?? null,
  storageConditions: prod.storageConditions ?? null,
  internalNotes: prod.internalNotes ?? null,
  categoryId: prod.categoryId ?? null,
  pharmaceuticalFormId: prod.pharmaceuticalFormId ?? null,
  createdById: prod.createdById,
});

const mapProductForUpdate = (prod: ProductRow): any => ({
  internalCode: prod.internalCode,
  commercialName: prod.commercialName,
  genericName: prod.genericName,
  activePrinciple: prod.activePrinciple,
  concentration: prod.concentration,
  concentrationUnit: prod.concentrationUnit,
  laboratory: prod.laboratory,
  saleType: prod.saleType,
  minimumStock: prod.minimumStock,
  isActive: prod.isActive,
  discontinuationReason: prod.discontinuationReason,
  invimaRegistry: prod.invimaRegistry,
  atcCode: prod.atcCode,
  therapeuticIndication: prod.therapeuticIndication,
  storageConditions: prod.storageConditions,
  internalNotes: prod.internalNotes,
  categoryId: prod.categoryId,
  pharmaceuticalFormId: prod.pharmaceuticalFormId,
});
