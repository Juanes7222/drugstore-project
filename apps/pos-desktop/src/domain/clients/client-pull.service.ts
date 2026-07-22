/**
 * Client-data pull synchronizer for the POS desktop app.
 *
 * Downloads the latest clients from the server into the local PGlite table
 * so the POS can search and display clients while offline.  Uses an
 * incremental strategy — only clients updated after the last successful
 * pull are fetched.
 *
 * ## Shape
 * Follows the same pattern as `CatalogSyncService` and `LotSyncService`:
 * a single `pullClients()` method, a factory function, and records its
 * completion in the shared `sync-metadata` store.
 */
import { PrismaClient, Prisma } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import {
  getClientsLastSyncedAt,
  setClientsLastSyncedAt,
  setClassificationsLastSyncedAt,
} from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';

// ---------------------------------------------------------------------------
// Config & factory
// ---------------------------------------------------------------------------

export interface ClientPullConfig {
  /** Server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
  /** Optional override of the HTTP client (for testing). */
  httpClient?: SyncHttpClient;
  /** Optional auth token for protected endpoints. */
  accessToken?: string;
}

export const createClientPullService = (
  prisma: PrismaClient,
  config: ClientPullConfig,
): ClientPullService => {
  return new ClientPullService(prisma, config);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ClientPullService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: ClientPullConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Pull client classifications from the server into the local database.
   *
   * Fetches all classifications from `GET /clients/classifications/all`
   * and upserts them into the local `ClientClassification` table so that
   * the FK from `Client.classificationId` resolves correctly.
   *
   * Records `classificationsLastSyncedAt` on success.
   * Safe to call when offline — returns early without throwing.
   */
  async pullClassifications(): Promise<void> {
    if (!isOnline()) return;

    const authHeaders = this.buildAuthHeaders();

    const response = await this.http.get<ClassificationRow[]>(
      `${this.baseUrl}/clients/classifications/all`,
      authHeaders,
    );

    if (response.length === 0) {
      setClassificationsLastSyncedAt(new Date().toISOString());
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const cls of response) {
        await tx.clientClassification.upsert({
          where: { id: cls.id },
          create: mapClassificationForCreate(cls),
          update: mapClassificationForUpdate(cls),
        });
      }
    });

    setClassificationsLastSyncedAt(new Date().toISOString());
  }

  /**
   * Pull clients from the server into the local database.
   *
   * - Fetches paginated clients from `GET /clients/sync`, optionally
   *   filtered by the `since` timestamp of the last successful pull.
   * - Upserts every row inside a single local transaction.
   * - Records `clientsLastSyncedAt` on success.
   *
   * Safe to call when offline — returns early without throwing.
   */
  async pullClients(): Promise<void> {
    if (!isOnline()) return;

    const authHeaders = this.buildAuthHeaders();
    const since = getClientsLastSyncedAt();
    const clients = await this.fetchAllClients(authHeaders, since);

    if (clients.length === 0) {
      // No new or updated clients — still update the timestamp so the
      // next pull does not re-request the same empty window.
      setClientsLastSyncedAt(new Date().toISOString());
      return;
    }

    const rows = clients as ClientRow[];

    // Look up existing local clients by business key once, then batch.
    const existingMap = new Map<string, string>();
    /* eslint-disable @typescript-eslint/no-explicit-any */
    if (rows.length > 0) {
      const all = await this.prisma.client.findMany({
        where: {
          OR: rows.map((c) => ({
            identificationType: c.identificationType,
            identificationNumber: c.identificationNumber,
          })),
        } as any,
        select: { identificationType: true, identificationNumber: true, id: true },
      });
      for (const e of all) {
        existingMap.set(`${e.identificationType}::${e.identificationNumber}`, e.id);
      }
    }

    // Build a set of known local classification IDs so we can null out
    // any FK reference that doesn't exist locally (defensive — the
    // classification sync may not have run yet or may be outdated).
    const knownClassificationIds = new Set<string>();
    {
      const all = await this.prisma.clientClassification.findMany({
        select: { id: true },
      });
      for (const c of all) knownClassificationIds.add(c.id);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const client of rows) {
        // Null out classificationId if the target classification does not
        // exist locally — avoids FK constraint violations when the server
        // references a classification we haven't synced yet.
        if (client.classificationId && !knownClassificationIds.has(client.classificationId)) {
          client.classificationId = null;
        }

        const key = `${client.identificationType}::${client.identificationNumber}`;
        const existingId = existingMap.get(key);

        if (existingId) {
          await tx.client.update({
            where: { id: existingId },
            data: mapClientForUpdate(client),
          });
        } else {
          await tx.client.create({
            data: mapClientForCreate(client),
          });
        }
      }
    });

    setClientsLastSyncedAt(new Date().toISOString());
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
   * Fetch all clients from the paginated /clients/sync endpoint.
   * Uses `pageSize: 200` to minimise round-trips.
   */
  private async fetchAllClients(
    authHeaders: Record<string, string>,
    since: string | null,
  ): Promise<unknown[]> {
    const pageSize = 200;
    let page = 1;
    let totalPages = 1;
    const all: unknown[] = [];

    while (page <= totalPages) {
      const sinceParam = since ? `&since=${encodeURIComponent(since)}` : '';
      const response = await this.http.get<{
        data: unknown[];
        total: number;
        page: number;
        pageSize: number;
      }>(
        `${this.baseUrl}/clients/sync?page=${page}&pageSize=${pageSize}${sinceParam}`,
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
// Default HTTP client
// ---------------------------------------------------------------------------

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new ClientPullHttpError(url, response.status, await response.text());
    }
    return response.json() as Promise<T>;
  },
};

// ---------------------------------------------------------------------------
// Local error
// ---------------------------------------------------------------------------

export class ClientPullHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(url: string, statusCode: number, responseBody: string) {
    super(`Client pull HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'ClientPullHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ---------------------------------------------------------------------------
// Row-shape types & mapping helpers
// ---------------------------------------------------------------------------

/** Minimal shape the server's GET /clients/sync response per item. */
interface ClientRow {
  id: string;
  fullName: string;
  identificationType: string;
  identificationNumber: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  municipality: string | null;
  department: string | null;
  isActive: boolean;
  classificationId: string | null;
  createdById: string;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
  consentGivenAt: string | null;
  consentVersion: string | null;
  consentScope: Record<string, unknown> | null;
  dataSubjectRequestStatus: string;
  dataSubjectRequestAt: string | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

const mapClientForCreate = (client: ClientRow): any => ({
  id: client.id,
  fullName: client.fullName,
  identificationType: client.identificationType,
  identificationNumber: client.identificationNumber,
  email: client.email ?? null,
  phone: client.phone ?? null,
  address: client.address ?? null,
  municipality: client.municipality ?? null,
  department: client.department ?? null,
  isActive: client.isActive,
  classificationId: client.classificationId ?? null,
  createdById: client.createdById,
  updatedById: client.updatedById ?? null,
  consentGivenAt: client.consentGivenAt ? new Date(client.consentGivenAt) : null,
  consentVersion: client.consentVersion ?? null,
  consentScope: client.consentScope ?? Prisma.DbNull,
  dataSubjectRequestStatus: client.dataSubjectRequestStatus,
  dataSubjectRequestAt: client.dataSubjectRequestAt ? new Date(client.dataSubjectRequestAt) : null,
});

const mapClientForUpdate = (client: ClientRow): any => ({
  fullName: client.fullName,
  identificationType: client.identificationType,
  identificationNumber: client.identificationNumber,
  email: client.email ?? null,
  phone: client.phone ?? null,
  address: client.address ?? null,
  municipality: client.municipality ?? null,
  department: client.department ?? null,
  isActive: client.isActive,
  classificationId: client.classificationId ?? null,
  updatedById: client.updatedById ?? null,
  consentGivenAt: client.consentGivenAt ? new Date(client.consentGivenAt) : null,
  consentVersion: client.consentVersion ?? null,
  consentScope: client.consentScope ?? Prisma.DbNull,
  dataSubjectRequestStatus: client.dataSubjectRequestStatus,
  dataSubjectRequestAt: client.dataSubjectRequestAt ? new Date(client.dataSubjectRequestAt) : null,
});

// ---------------------------------------------------------------------------
// Classification types & mapping helpers
// ---------------------------------------------------------------------------

/** Shape returned by GET /clients/classifications/all per item. */
interface ClassificationRow {
  id: string;
  type: string;
  discountPercentage: number;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const mapClassificationForCreate = (cls: ClassificationRow): any => ({
  id: cls.id,
  type: cls.type,
  discountPercentage: cls.discountPercentage,
  sortOrder: cls.sortOrder,
  isActive: cls.isActive,
  createdAt: new Date(cls.createdAt),
  updatedAt: new Date(cls.updatedAt),
});

const mapClassificationForUpdate = (cls: ClassificationRow): any => ({
  type: cls.type,
  discountPercentage: cls.discountPercentage,
  sortOrder: cls.sortOrder,
  isActive: cls.isActive,
  updatedAt: new Date(cls.updatedAt),
});
