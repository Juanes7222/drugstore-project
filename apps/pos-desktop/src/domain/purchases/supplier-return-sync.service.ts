/**
 * Supplier-return pull synchronizer — hydrates local SupplierReturn + items.
 * Server: GET /purchases/supplier-returns/sync
 */

import { PrismaClient, Prisma } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import {
  getSupplierReturnsLastSyncedAt,
  setSupplierReturnsLastSyncedAt,
} from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';

export interface SupplierReturnSyncConfig {
  baseUrl: string;
  httpClient?: SyncHttpClient;
  accessToken?: string;
  offlineToken?: string;
}

export const createSupplierReturnSyncService = (
  prisma: PrismaClient,
  config: SupplierReturnSyncConfig,
): SupplierReturnSyncService => new SupplierReturnSyncService(prisma, config);

export class SupplierReturnSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly offlineToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: SupplierReturnSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.offlineToken = config.offlineToken;
  }

  async pullSupplierReturns(): Promise<void> {
    if (!isOnline()) return;
    const rows = await this.fetchSupplierReturns();
    await this.applySupplierReturns(rows);
  }

  async fetchSupplierReturns(): Promise<SupplierReturnRow[]> {
    const authHeaders = this.buildAuthHeaders();
    return this.fetchAll(authHeaders);
  }

  async applySupplierReturns(rows: SupplierReturnRow[]): Promise<void> {
    if (rows.length === 0) {
      setSupplierReturnsLastSyncedAt(new Date().toISOString());
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const ret of rows) {
        await tx.supplierReturn.upsert({
          where: { id: ret.id },
          create: mapReturnForCreate(ret),
          update: mapReturnForUpdate(ret),
        });

        const incomingIds = new Set(ret.items.map((i) => i.id));
        await tx.supplierReturnItem.deleteMany({
          where: { supplierReturnId: ret.id, id: { notIn: [...incomingIds] } },
        });
        for (const item of ret.items) {
          await tx.supplierReturnItem.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              supplierReturnId: ret.id,
              productId: item.productId,
              lotId: item.lotId,
              quantity: item.quantity,
              unitCost: new Prisma.Decimal(item.unitCost),
              totalAmount: new Prisma.Decimal(item.totalAmount ?? 0),
            },
            update: {
              productId: item.productId,
              lotId: item.lotId,
              quantity: item.quantity,
              unitCost: new Prisma.Decimal(item.unitCost),
              totalAmount: new Prisma.Decimal(item.totalAmount ?? 0),
            },
          });
        }
      }
    });

    setSupplierReturnsLastSyncedAt(new Date().toISOString());
  }

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    if (this.offlineToken) headers['X-Offline-Token'] = this.offlineToken;
    return headers;
  }

  private async fetchAll(authHeaders: Record<string, string>): Promise<SupplierReturnRow[]> {
    const limit = 200;
    const updatedSince = getSupplierReturnsLastSyncedAt();
    const all: SupplierReturnRow[] = [];
    let cursor: string | null = null;
    while (true) {
      let url = `${this.baseUrl}/purchases/supplier-returns/sync?limit=${limit}`;
      if (updatedSince) url += `&updatedSince=${encodeURIComponent(updatedSince)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      try {
        const res = await this.http.get<{ data: SupplierReturnRow[]; nextCursor: string | null; hasMore: boolean }>(url, authHeaders);
        all.push(...(res.data ?? []));
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
      } catch (err: unknown) {
        if (err instanceof SupplierReturnSyncHttpError && (err.statusCode === 401 || err.statusCode === 403)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/\b401\b|\b403\b|\bUnauthorized\b|\bForbidden\b/i.test(msg)) throw err;
        return this.fetchLegacy(authHeaders);
      }
    }
    return all;
  }

  private async fetchLegacy(authHeaders: Record<string, string>): Promise<SupplierReturnRow[]> {
    const pageSize = 200;
    let page = 1;
    let totalPages = 1;
    const all: SupplierReturnRow[] = [];
    while (page <= totalPages) {
      const res = await this.http.get<{ data: SupplierReturnRow[]; total: number; page: number; pageSize: number }>(
        `${this.baseUrl}/purchases/supplier-returns?page=${page}&pageSize=${pageSize}`,
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
    if (!response.ok) throw new SupplierReturnSyncHttpError(url, response.status, await response.text());
    return response.json() as Promise<T>;
  },
};

export class SupplierReturnSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  constructor(url: string, statusCode: number, responseBody: string) {
    super(`SupplierReturn sync HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'SupplierReturnSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

interface SupplierReturnRow {
  id: string;
  sequentialNumber: number;
  state: string;
  supplierId: string;
  purchaseReceptionId: string | null;
  reason: string | null;
  notes: string | null;
  subtotal: string | number;
  totalTax: string | number;
  totalAmount: string | number;
  createdAt: string;
  createdById: string;
  updatedAt: string;
  items: Array<{
    id: string;
    productId: string;
    lotId: string;
    quantity: number;
    unitCost: string | number;
    totalAmount: string | number;
  }>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapReturnForCreate = (r: SupplierReturnRow): any => ({
  id: r.id,
  sequentialNumber: r.sequentialNumber,
  state: r.state as any,
  supplierId: r.supplierId,
  purchaseReceptionId: r.purchaseReceptionId ?? null,
  reason: r.reason ?? null,
  notes: r.notes ?? null,
  subtotal: new Prisma.Decimal(r.subtotal),
  totalTax: new Prisma.Decimal(r.totalTax),
  totalAmount: new Prisma.Decimal(r.totalAmount),
  createdAt: new Date(r.createdAt),
  createdById: r.createdById,
  updatedAt: new Date(r.updatedAt ?? r.createdAt),
});

const mapReturnForUpdate = (r: SupplierReturnRow): any => ({
  state: r.state as any,
  supplierId: r.supplierId,
  purchaseReceptionId: r.purchaseReceptionId ?? null,
  reason: r.reason ?? null,
  notes: r.notes ?? null,
  subtotal: new Prisma.Decimal(r.subtotal),
  totalTax: new Prisma.Decimal(r.totalTax),
  totalAmount: new Prisma.Decimal(r.totalAmount),
  updatedAt: new Date(r.updatedAt ?? r.createdAt),
});
