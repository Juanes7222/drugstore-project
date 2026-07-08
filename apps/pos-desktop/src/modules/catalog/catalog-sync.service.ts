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
 * - Products (including their barcodes)
 * - Categories
 * - Pharmaceutical forms
 *
 * Price and tax histories are excluded from the local cache; the POS
 * reads the server's authoritative price for every sale confirmation.
 */

import { PrismaClient } from '@pharmacy/database/local';
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
   * - Fetches categories, pharmaceutical forms, and paginated products.
   * - Upserts every row inside a single local transaction (all-or-nothing).
   * - Records `catalogLastSyncedAt` on success.
   *
   * Safe to call when offline — returns early without throwing.
   * Safe to call concurrently — conflicts are handled by the single
   * transaction wrapping all upserts.
   */
  async pullCatalog(): Promise<void> {
    if (!isOnline()) return;

    const authHeaders = this.buildAuthHeaders();

    // Fetch reference data (categories + forms) in parallel
    const [categories, pharmaceuticalForms] = await Promise.all([
      this.http.get<unknown[]>(`${this.baseUrl}/catalog/categories`, authHeaders),
      this.http.get<unknown[]>(`${this.baseUrl}/catalog/pharmaceutical-forms`, authHeaders),
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
      }
    });

    setCatalogLastSyncedAt(new Date().toISOString());
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
}

interface BarcodeRow {
  id: string;
  barcode: string;
  barcodeType: string;
  isPrimary: boolean;
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
});
