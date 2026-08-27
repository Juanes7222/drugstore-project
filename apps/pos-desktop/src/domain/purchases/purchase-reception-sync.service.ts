/**
 * Purchase-reception pull synchronizer — hydrates local PurchaseReception + items.
 *
 * Server: GET /purchases/receptions/sync
 * Local:  PurchaseReception upsert by id + items
 */

import { PrismaClient, Prisma } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import {
  getPurchaseReceptionsLastSyncedAt,
  setPurchaseReceptionsLastSyncedAt,
} from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';

export interface PurchaseReceptionSyncConfig {
  baseUrl: string;
  httpClient?: SyncHttpClient;
  accessToken?: string;
}

export const createPurchaseReceptionSyncService = (
  prisma: PrismaClient,
  config: PurchaseReceptionSyncConfig,
): PurchaseReceptionSyncService => new PurchaseReceptionSyncService(prisma, config);

export class PurchaseReceptionSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: PurchaseReceptionSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
  }

  async pullReceptions(): Promise<void> {
    if (!isOnline()) return;
    const rows = await this.fetchReceptions();
    await this.applyReceptions(rows);
  }

  async fetchReceptions(): Promise<ReceptionRow[]> {
    const authHeaders = this.buildAuthHeaders();
    return this.fetchAll(authHeaders);
  }

  async applyReceptions(rows: ReceptionRow[]): Promise<void> {
    if (rows.length === 0) {
      setPurchaseReceptionsLastSyncedAt(new Date().toISOString());
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const r of rows) {
        await tx.purchaseReception.upsert({
          where: { id: r.id },
          create: mapReceptionForCreate(r),
          update: mapReceptionForUpdate(r),
        });

        const incomingIds = new Set(r.items.map((i) => i.id));
        await tx.purchaseReceptionItem.deleteMany({
          where: { purchaseReceptionId: r.id, id: { notIn: [...incomingIds] } },
        });
        for (const item of r.items) {
          await tx.purchaseReceptionItem.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              purchaseReceptionId: r.id,
              productId: item.productId,
              purchaseOrderItemId: item.purchaseOrderItemId ?? null,
              lotId: item.lotId ?? null,
              receivedQuantity: item.receivedQuantity,
              lotNumber: item.lotNumber ?? null,
              expirationDate: item.expirationDate ? new Date(item.expirationDate) : null,
              realUnitCost: new Prisma.Decimal(item.realUnitCost),
              taxSchemeId: item.taxSchemeId,
              taxRate: new Prisma.Decimal(item.taxRate ?? 0),
              taxAmount: new Prisma.Decimal(item.taxAmount ?? 0),
              discountAmount: new Prisma.Decimal(item.discountAmount ?? 0),
              subtotal: new Prisma.Decimal(item.subtotal ?? 0),
              total: new Prisma.Decimal(item.total ?? 0),
            },
            update: {
              productId: item.productId,
              purchaseOrderItemId: item.purchaseOrderItemId ?? null,
              lotId: item.lotId ?? null,
              receivedQuantity: item.receivedQuantity,
              lotNumber: item.lotNumber ?? null,
              expirationDate: item.expirationDate ? new Date(item.expirationDate) : null,
              realUnitCost: new Prisma.Decimal(item.realUnitCost),
              taxSchemeId: item.taxSchemeId,
              taxRate: new Prisma.Decimal(item.taxRate ?? 0),
              taxAmount: new Prisma.Decimal(item.taxAmount ?? 0),
              discountAmount: new Prisma.Decimal(item.discountAmount ?? 0),
              subtotal: new Prisma.Decimal(item.subtotal ?? 0),
              total: new Prisma.Decimal(item.total ?? 0),
            },
          });
        }
      }
    });

    setPurchaseReceptionsLastSyncedAt(new Date().toISOString());
  }

  private buildAuthHeaders(): Record<string, string> {
    if (this.accessToken) return { Authorization: `Bearer ${this.accessToken}` };
    return {};
  }

  private async fetchAll(authHeaders: Record<string, string>): Promise<ReceptionRow[]> {
    const limit = 200;
    const updatedSince = getPurchaseReceptionsLastSyncedAt();
    const all: ReceptionRow[] = [];
    let cursor: string | null = null;
    while (true) {
      let url = `${this.baseUrl}/purchases/receptions/sync?limit=${limit}`;
      if (updatedSince) url += `&updatedSince=${encodeURIComponent(updatedSince)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      try {
        const res = await this.http.get<{ data: ReceptionRow[]; nextCursor: string | null; hasMore: boolean }>(url, authHeaders);
        all.push(...(res.data ?? []));
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
      } catch {
        return this.fetchLegacy(authHeaders);
      }
    }
    return all;
  }

  private async fetchLegacy(authHeaders: Record<string, string>): Promise<ReceptionRow[]> {
    const pageSize = 200;
    let page = 1;
    let totalPages = 1;
    const all: ReceptionRow[] = [];
    while (page <= totalPages) {
      const res = await this.http.get<{ data: ReceptionRow[]; total: number; page: number; pageSize: number }>(
        `${this.baseUrl}/purchases/receptions?page=${page}&pageSize=${pageSize}`,
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
    if (!response.ok) throw new PurchaseReceptionSyncHttpError(url, response.status, await response.text());
    return response.json() as Promise<T>;
  },
};

export class PurchaseReceptionSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  constructor(url: string, statusCode: number, responseBody: string) {
    super(`PurchaseReception sync HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'PurchaseReceptionSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

interface ReceptionRow {
  id: string;
  sequentialNumber: number;
  state: string;
  supplierId: string;
  purchaseOrderId: string | null;
  notes: string | null;
  subtotal: string | number;
  totalTax: string | number;
  totalAmount: string | number;
  createdAt: string;
  createdById: string;
  receivedAt: string | null;
  annulledAt: string | null;
  updatedAt: string;
  items: Array<{
    id: string;
    productId: string;
    purchaseOrderItemId: string | null;
    lotId: string | null;
    receivedQuantity: number;
    lotNumber: string | null;
    expirationDate: string | null;
    realUnitCost: string | number;
    taxSchemeId: string;
    taxRate: string | number;
    taxAmount: string | number;
    discountAmount: string | number;
    subtotal: string | number;
    total: string | number;
  }>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapReceptionForCreate = (r: ReceptionRow): any => ({
  id: r.id,
  sequentialNumber: r.sequentialNumber,
  state: r.state as any,
  supplierId: r.supplierId,
  purchaseOrderId: r.purchaseOrderId ?? null,
  notes: r.notes ?? null,
  subtotal: new Prisma.Decimal(r.subtotal),
  totalTax: new Prisma.Decimal(r.totalTax),
  totalAmount: new Prisma.Decimal(r.totalAmount),
  createdAt: new Date(r.createdAt),
  createdById: r.createdById,
  receivedAt: r.receivedAt ? new Date(r.receivedAt) : null,
  annulledAt: r.annulledAt ? new Date(r.annulledAt) : null,
  updatedAt: new Date(r.updatedAt ?? r.createdAt),
});

const mapReceptionForUpdate = (r: ReceptionRow): any => ({
  state: r.state as any,
  supplierId: r.supplierId,
  purchaseOrderId: r.purchaseOrderId ?? null,
  notes: r.notes ?? null,
  subtotal: new Prisma.Decimal(r.subtotal),
  totalTax: new Prisma.Decimal(r.totalTax),
  totalAmount: new Prisma.Decimal(r.totalAmount),
  receivedAt: r.receivedAt ? new Date(r.receivedAt) : null,
  annulledAt: r.annulledAt ? new Date(r.annulledAt) : null,
  updatedAt: new Date(r.updatedAt ?? r.createdAt),
});
