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
import { PrismaClient, Prisma, IdentificationType, DataSubjectRequestStatus } from '@pharmacy/database/local';
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
  /** Long-lived offline token fallback (X-Offline-Token). */
  offlineToken?: string;
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
  private readonly offlineToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: ClientPullConfig,
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
    const rows = await this.fetchClassifications();
    await this.applyClassifications(rows);
  }

  /**
   * Network phase: fetch all classifications from
   * `GET /clients/classifications/all`. No database access — safe to run
   * without the PGlite write lock.
   */
  async fetchClassifications(): Promise<ClassificationRow[]> {
    const authHeaders = this.buildAuthHeaders();
    return this.http.get<ClassificationRow[]>(
      `${this.baseUrl}/clients/classifications/all`,
      authHeaders,
    );
  }

  /**
   * Apply phase: upsert the fetched classifications and record
   * `classificationsLastSyncedAt`. Must run under the PGlite write lock.
   */
  async applyClassifications(rows: ClassificationRow[]): Promise<void> {
    if (rows.length === 0) {
      setClassificationsLastSyncedAt(new Date().toISOString());
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const cls of rows) {
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
    const clients = await this.fetchClients();
    await this.applyClients(clients);
  }

  /**
   * Network phase: fetch all clients from the paginated `/clients/sync`
   * endpoint, filtered by the last successful pull timestamp. No database
   * access — safe to run without the PGlite write lock.
   */
  async fetchClients(): Promise<ClientRow[]> {
    const authHeaders = this.buildAuthHeaders();
    const since = getClientsLastSyncedAt();
    return (await this.fetchAllClients(authHeaders, since)) as ClientRow[];
  }

  /**
   * Apply phase: batch-upsert the fetched clients and record
   * `clientsLastSyncedAt`. Must run under the PGlite write lock.
   */
  async applyClients(clients: ClientRow[]): Promise<void> {
    if (clients.length === 0) {
      // No new or updated clients — still update the timestamp so the
      // next pull does not re-request the same empty window.
      setClientsLastSyncedAt(new Date().toISOString());
      return;
    }

    const rows = clients;

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

    // Batch upsert in chunks. The unique index on
    // (identificationType, identificationNumber) makes ON CONFLICT resolve
    // insert-vs-update in a single statement per chunk, so the old
    // thousands-entry OR lookup and the per-row create/update loop are gone.
    await this.prisma.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += CLIENT_UPSERT_BATCH_SIZE) {
        const chunk = rows.slice(i, i + CLIENT_UPSERT_BATCH_SIZE);
        await upsertClientsChunk(tx, chunk, knownClassificationIds);
      }
    });

    setClientsLastSyncedAt(new Date().toISOString());
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
  /** Store credit limit in COP (Decimal serialized to string). */
  creditLimit: string | number | null;
}

// ---------------------------------------------------------------------------
// Batch upsert helpers
// ---------------------------------------------------------------------------

/**
 * Rows per INSERT ... ON CONFLICT statement.
 *
 * Keeps the statement (and its parameter count) bounded so PostgreSQL never
 * approaches the 65 535 parameter limit and PGlite's single connection is
 * held for short bursts instead of one giant statement.
 */
const CLIENT_UPSERT_BATCH_SIZE = 500;

/**
 * Upsert a chunk of client rows.
 *
 * Runs inside the caller's transaction and issues one typed Prisma upsert per
 * row instead of a hand-built batch INSERT. The batch statement was faster, but
 * it went through $executeRawUnsafe, and the Tauri WebView has no
 * SharedArrayBuffer, so PGlite cannot prepare that statement there: the pull
 * failed at runtime in the app while passing in Node.
 *
 * `id`, `createdAt` and `createdById` are intentionally NOT updated on conflict
 * so an existing local row keeps its identity, mirroring the previous
 * update-by-existing-id behaviour.
 */
async function upsertClientsChunk(
  tx: Prisma.TransactionClient,
  rows: ClientRow[],
  knownClassificationIds: Set<string>,
): Promise<void> {
  for (const client of rows) {
    // Null out classificationId if the target classification does not exist
    // locally — avoids FK constraint violations when the server references a
    // classification we haven't synced yet.
    const classificationId =
      client.classificationId && knownClassificationIds.has(client.classificationId)
        ? client.classificationId
        : null;

    const data = {
      id: client.id,
      fullName: client.fullName,
      identificationType: client.identificationType as IdentificationType,
      identificationNumber: client.identificationNumber,
      email: client.email ?? null,
      phone: client.phone ?? null,
      address: client.address ?? null,
      municipality: client.municipality ?? null,
      department: client.department ?? null,
      isActive: client.isActive,
      classificationId,
      createdById: client.createdById,
      updatedById: client.updatedById ?? null,
      consentGivenAt: client.consentGivenAt
        ? new Date(client.consentGivenAt)
        : null,
      consentVersion: client.consentVersion ?? null,
      consentScope: (client.consentScope ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      dataSubjectRequestStatus:
        client.dataSubjectRequestStatus as DataSubjectRequestStatus,
      dataSubjectRequestAt: client.dataSubjectRequestAt
        ? new Date(client.dataSubjectRequestAt)
        : null,
      creditLimit:
        client.creditLimit !== null && client.creditLimit !== undefined
          ? String(client.creditLimit)
          : null,
      createdAt: new Date(client.createdAt),
      updatedAt: new Date(client.updatedAt),
    };

    await tx.client.upsert({
      where: {
        identificationType_identificationNumber: {
          identificationType: data.identificationType,
          identificationNumber: data.identificationNumber,
        },
      },
      create: data,
      update: {
        fullName: data.fullName,
        email: data.email,
        phone: data.phone,
        address: data.address,
        municipality: data.municipality,
        department: data.department,
        isActive: data.isActive,
        classificationId: data.classificationId,
        updatedById: data.updatedById,
        consentGivenAt: data.consentGivenAt,
        consentVersion: data.consentVersion,
        consentScope: data.consentScope,
        dataSubjectRequestStatus: data.dataSubjectRequestStatus,
        dataSubjectRequestAt: data.dataSubjectRequestAt,
        creditLimit: data.creditLimit,
        updatedAt: data.updatedAt,
      },
    });
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */

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
