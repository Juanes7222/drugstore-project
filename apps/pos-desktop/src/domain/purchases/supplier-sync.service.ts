/**
 * Supplier pull synchronizer — hydrates local Supplier mirror from server.
 *
 * Server source: GET /purchases/suppliers/sync (cursor + updatedSince, see SuppliersService.findSync).
 * Local apply: upsert by id inside one transaction.
 * Pattern mirrors CatalogSyncService / LotSyncService.
 */

import { PrismaClient, Prisma } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import {
  getSuppliersLastSyncedAt,
  setSuppliersLastSyncedAt,
} from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';

// ---------------------------------------------------------------------------
// Config & factory
// ---------------------------------------------------------------------------

export interface SupplierSyncConfig {
  baseUrl: string;
  httpClient?: SyncHttpClient;
  accessToken?: string;
}

export const createSupplierSyncService = (
  prisma: PrismaClient,
  config: SupplierSyncConfig,
): SupplierSyncService => {
  return new SupplierSyncService(prisma, config);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class SupplierSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: SupplierSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
  }

  /** Convenience wrapper — fetch + apply, respects offline. */
  async pullSuppliers(): Promise<void> {
    if (!isOnline()) return;
    const rows = await this.fetchSuppliers();
    await this.applySuppliers(rows);
  }

  /** Network phase — no DB, safe without write lock. */
  async fetchSuppliers(): Promise<SupplierRow[]> {
    const authHeaders = this.buildAuthHeaders();
    return this.fetchAllSuppliers(authHeaders);
  }

  /** Apply phase — upsert rows and record cursor. Must run under write lock. */
  async applySuppliers(rows: SupplierRow[]): Promise<void> {
    if (rows.length === 0) {
      setSuppliersLastSyncedAt(new Date().toISOString());
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const s of rows) {
        await tx.supplier.upsert({
          where: { id: s.id },
          create: mapSupplierForCreate(s),
          update: mapSupplierForUpdate(s),
        });
      }
    });

    setSuppliersLastSyncedAt(new Date().toISOString());
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private buildAuthHeaders(): Record<string, string> {
    if (this.accessToken) return { Authorization: `Bearer ${this.accessToken}` };
    return {};
  }

  private async fetchAllSuppliers(authHeaders: Record<string, string>): Promise<SupplierRow[]> {
    const limit = 200;
    const updatedSince = getSuppliersLastSyncedAt();
    const all: SupplierRow[] = [];
    let cursor: string | null = null;

    while (true) {
      let url = `${this.baseUrl}/purchases/suppliers/sync?limit=${limit}`;
      if (updatedSince) url += `&updatedSince=${encodeURIComponent(updatedSince)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

      try {
        const res = await this.http.get<{
          data: SupplierRow[];
          nextCursor: string | null;
          hasMore: boolean;
          // catalog shape compatibility
          items?: SupplierRow[];
        }>(url, authHeaders);
        const chunk = (res.data ?? (res as unknown as { items: SupplierRow[] }).items ?? []) as SupplierRow[];
        all.push(...chunk);
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
      } catch {
        // Legacy fallback — offset pagination (pre-sync-endpoint servers)
        return this.fetchAllSuppliersLegacy(authHeaders);
      }
    }
    return all;
  }

  private async fetchAllSuppliersLegacy(authHeaders: Record<string, string>): Promise<SupplierRow[]> {
    const pageSize = 200;
    let page = 1;
    let totalPages = 1;
    const all: SupplierRow[] = [];
    while (page <= totalPages) {
      const res = await this.http.get<{ data: SupplierRow[]; total: number; page: number; pageSize: number }>(
        `${this.baseUrl}/purchases/suppliers?page=${page}&pageSize=${pageSize}`,
        authHeaders,
      );
      all.push(...res.data);
      totalPages = Math.ceil(res.total / res.pageSize);
      page++;
    }
    return all;
  }
}

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new SupplierSyncHttpError(url, response.status, await response.text());
    return response.json() as Promise<T>;
  },
};

export class SupplierSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  constructor(url: string, statusCode: number, responseBody: string) {
    super(`Supplier sync HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'SupplierSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

// ---------------------------------------------------------------------------
// Row shape & mappers
// ---------------------------------------------------------------------------

interface SupplierRow {
  id: string;
  identificationType: string;
  identificationNumber: string;
  businessName: string;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  country: string;
  paymentTermsDays: number;
  creditLimit: string | number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdById: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapSupplierForCreate = (s: SupplierRow): any => ({
  id: s.id,
  identificationType: s.identificationType as any,
  identificationNumber: s.identificationNumber,
  businessName: s.businessName,
  contactName: s.contactName ?? null,
  phone: s.phone ?? null,
  email: s.email ?? null,
  address: s.address ?? null,
  city: s.city ?? null,
  country: s.country ?? 'CO',
  paymentTermsDays: s.paymentTermsDays ?? 0,
  creditLimit: new Prisma.Decimal(s.creditLimit ?? 0),
  isActive: s.isActive,
  createdAt: new Date(s.createdAt),
  updatedAt: new Date(s.updatedAt),
  createdById: s.createdById,
});

const mapSupplierForUpdate = (s: SupplierRow): any => ({
  identificationType: s.identificationType as any,
  identificationNumber: s.identificationNumber,
  businessName: s.businessName,
  contactName: s.contactName ?? null,
  phone: s.phone ?? null,
  email: s.email ?? null,
  address: s.address ?? null,
  city: s.city ?? null,
  country: s.country ?? 'CO',
  paymentTermsDays: s.paymentTermsDays ?? 0,
  creditLimit: new Prisma.Decimal(s.creditLimit ?? 0),
  isActive: s.isActive,
  updatedAt: new Date(s.updatedAt),
});
