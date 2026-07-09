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
import { getClientsLastSyncedAt, setClientsLastSyncedAt } from '../../common/sync-metadata';
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

    await this.prisma.$transaction(async (tx) => {
      for (const client of clients as ClientRow[]) {
        await tx.client.upsert({
          where: { id: client.id },
          create: mapClientForCreate(client),
          update: mapClientForUpdate(client),
        });
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
