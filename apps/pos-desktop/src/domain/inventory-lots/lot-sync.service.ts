/**
 * Local lot-data synchronizer.
 *
 * Pulls the server's active lots for all the pharmacy's products into the
 * local `Lot` table so `consumeStockForSale` can operate against a
 * reasonably up-to-date picture of available stock while offline.
 *
 * ## Shape
 * Follows the same pattern as `CatalogSyncService`:
 * - Single `pullLots()` method
 * - Factory function (`createLotSyncService`)
 * - Records completion in the shared `sync-metadata` store under
 *   `lotsLastSyncedAt`
 *
 * ## What it syncs
 * Every row the server returns from `GET /inventory-lots/lots` is upserted
 * by `id`.  Lots that disappeared on the server (annulled receptions,
 * merged lots) are NOT deleted from the local table — a soft state like
 * `EXHAUSTED` or `BLOCKED` is sufficient for correctness, and deleting
 * would orphan the historical `InventoryMovement` rows that reference them.
 */

import { PrismaClient, LotState } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import { getLotsLastSyncedAt, setLotsLastSyncedAt } from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';

// ---------------------------------------------------------------------------
// Config & factory
// ---------------------------------------------------------------------------

export interface LotSyncConfig {
  /** Server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
  /** Optional override of the HTTP client (for testing). */
  httpClient?: SyncHttpClient;
  /** Optional auth token for protected endpoints. */
  accessToken?: string;
  /** Long-lived offline token fallback (X-Offline-Token). */
  offlineToken?: string;
}

export const createLotSyncService = (
  prisma: PrismaClient,
  config: LotSyncConfig,
): LotSyncService => {
  return new LotSyncService(prisma, config);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LotSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly offlineToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: LotSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.offlineToken = config.offlineToken;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Pull active lots from the server into the local database.
   *
   * Convenience wrapper over `fetchLots` + `applyLots` for callers that do
   * not orchestrate the PGlite write lock themselves. The sync scheduler
   * calls the two phases separately so the paginated fetches never hold
   * the lock.
   *
   * Safe to call when offline — returns early without throwing.
   */
  async pullLots(): Promise<void> {
    if (!isOnline()) return;
    const lots = await this.fetchLots();
    await this.applyLots(lots);
  }

  /**
   * Network phase: fetch every lot from `GET /inventory-lots/lots` (all
   * states, sorted by expiration date ascending).
   *
   * No database access — safe to run without the PGlite write lock.
   */
  async fetchLots(): Promise<unknown[]> {
    const authHeaders = this.buildAuthHeaders();
    return this.fetchAllLots(authHeaders);
  }

  /**
   * Apply phase: upsert the fetched lots inside a single local transaction
   * and record `lotsLastSyncedAt`. Must run under the PGlite write lock.
   */
  async applyLots(lots: unknown[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const lot of lots as LotRow[]) {
        await tx.lot.upsert({
          where: { id: lot.id },
          create: {
            id: lot.id,
            batchNumber: lot.batchNumber,
            expirationDate: new Date(lot.expirationDate),
            entryDate: new Date(lot.entryDate),
            state: lot.state as LotState,
            currentStock: lot.currentStock,
            version: lot.version,
            productId: lot.productId,
            locationCode: lot.locationCode ?? null,
            createdAt: new Date(lot.createdAt),
            updatedAt: new Date(lot.updatedAt),
            blockedAt: lot.blockedAt ? new Date(lot.blockedAt) : null,
            blockedByUserId: lot.blockedByUserId ?? null,
            blockReason: lot.blockReason ?? null,
          },
          update: {
            batchNumber: lot.batchNumber,
            expirationDate: new Date(lot.expirationDate),
            entryDate: new Date(lot.entryDate),
            state: lot.state as LotState,
            // IMPORTANT: Do NOT overwrite currentStock or version.
            // Local inventory adjustments and sales change stock
            // independently.  The server's stock value is stale until
            // the sync queue replays local operations against it.
            // Overwriting would silently revert local mutations.
            productId: lot.productId,
            locationCode: lot.locationCode ?? null,
            updatedAt: new Date(lot.updatedAt),
            blockedAt: lot.blockedAt ? new Date(lot.blockedAt) : null,
            blockedByUserId: lot.blockedByUserId ?? null,
            blockReason: lot.blockReason ?? null,
          },
        });
      }
    });

    setLotsLastSyncedAt(new Date().toISOString());
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if (this.offlineToken) headers['X-Offline-Token'] = this.offlineToken;
    return headers;
  }

  /**
   * Fetch all lots from the cursor-paginated sync endpoint.
   *
   * Uses `updatedSince` from the last sync timestamp for incremental
   * pulls. Falls back to legacy offset pagination when the cursor
   * endpoint is unavailable.
   */
  private async fetchAllLots(authHeaders: Record<string, string>): Promise<unknown[]> {
    const limit = 200;
    const updatedSince = getLotsLastSyncedAt();
    const all: unknown[] = [];

    let cursor: string | null = null;

    while (true) {
      let url = `${this.baseUrl}/inventory-lots/lots/sync?limit=${limit}`;
      if (updatedSince) url += `&updatedSince=${encodeURIComponent(updatedSince)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

      try {
        const response = await this.http.get<{
          data: unknown[];
          nextCursor: string | null;
          hasMore: boolean;
        }>(url, authHeaders);

        all.push(...response.data);
        if (!response.hasMore || !response.nextCursor) break;
        cursor = response.nextCursor;
      } catch {
        // Cursor endpoint unavailable — fall back to legacy offset pagination.
        return this.fetchAllLotsLegacy(authHeaders);
      }
    }

    return all;
  }

  /**
   * Legacy fallback: offset-based lot pull.
   */
  private async fetchAllLotsLegacy(authHeaders: Record<string, string>): Promise<unknown[]> {
    const pageSize = 500;
    let page = 1;
    let totalPages = 1;
    const all: unknown[] = [];

    while (page <= totalPages) {
      const response = await this.http.get<{
        data: unknown[];
        total: number;
        page: number;
        pageSize: number;
      }>(
        `${this.baseUrl}/inventory-lots/lots?page=${page}&pageSize=${pageSize}`,
        authHeaders,
      );

      all.push(...response.data);
      totalPages = Math.ceil(response.total / response.pageSize);
      page++;
    }

    return all;
  }
}

// ---------------------------------------------------------------------------
// Default HTTP client (same as catalog-sync)
// ---------------------------------------------------------------------------

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new LotSyncHttpError(url, response.status, await response.text());
    }
    return response.json() as Promise<T>;
  },
};

// ---------------------------------------------------------------------------
// Local error
// ---------------------------------------------------------------------------

export class LotSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(url: string, statusCode: number, responseBody: string) {
    super(`Lot sync HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'LotSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ---------------------------------------------------------------------------
// Row-shape from the server's GET /inventory-lots/lots response
// ---------------------------------------------------------------------------

interface LotRow {
  id: string;
  batchNumber: string;
  expirationDate: string;
  entryDate: string;
  state: string;
  currentStock: number;
  version: number;
  productId: string;
  locationCode: string | null;
  createdAt: string;
  updatedAt: string;
  blockedAt: string | null;
  blockedByUserId: string | null;
  blockReason: string | null;
}
