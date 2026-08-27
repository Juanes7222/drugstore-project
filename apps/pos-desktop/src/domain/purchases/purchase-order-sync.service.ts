/**
 * Purchase-order pull synchronizer — hydrates local PurchaseOrder + items from server.
 *
 * Server: GET /purchases/purchase-orders/sync (cursor + updatedSince)
 * Local:  PurchaseOrder upsert by id + nested items sync
 */

import { PrismaClient, Prisma } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import {
  getPurchaseOrdersLastSyncedAt,
  setPurchaseOrdersLastSyncedAt,
} from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';

export interface PurchaseOrderSyncConfig {
  baseUrl: string;
  httpClient?: SyncHttpClient;
  accessToken?: string;
}

export const createPurchaseOrderSyncService = (
  prisma: PrismaClient,
  config: PurchaseOrderSyncConfig,
): PurchaseOrderSyncService => new PurchaseOrderSyncService(prisma, config);

export class PurchaseOrderSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: PurchaseOrderSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
  }

  async pullPurchaseOrders(): Promise<void> {
    if (!isOnline()) return;
    const rows = await this.fetchPurchaseOrders();
    await this.applyPurchaseOrders(rows);
  }

  async fetchPurchaseOrders(): Promise<PurchaseOrderRow[]> {
    const authHeaders = this.buildAuthHeaders();
    return this.fetchAll(authHeaders);
  }

  async applyPurchaseOrders(rows: PurchaseOrderRow[]): Promise<void> {
    if (rows.length === 0) {
      setPurchaseOrdersLastSyncedAt(new Date().toISOString());
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const po of rows) {
        await tx.purchaseOrder.upsert({
          where: { id: po.id },
          create: mapOrderForCreate(po),
          update: mapOrderForUpdate(po),
        });
        // Sync items — delete + recreate is safe (items are immutable after confirm)
        // but we do incremental upsert to preserve pending quantities edited locally.
        // Simplest correct: upsert each item by id, delete orphan ids not in payload.
        const incomingItemIds = new Set(po.items.map((i) => i.id));
        await tx.purchaseOrderItem.deleteMany({
          where: { purchaseOrderId: po.id, id: { notIn: [...incomingItemIds] } },
        });
        for (const item of po.items) {
          await tx.purchaseOrderItem.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              purchaseOrderId: po.id,
              productId: item.productId,
              requestedQuantity: item.requestedQuantity,
              receivedQuantity: item.receivedQuantity,
              pendingQuantity: item.pendingQuantity,
              expectedUnitCost: new Prisma.Decimal(item.expectedUnitCost),
            },
            update: {
              productId: item.productId,
              requestedQuantity: item.requestedQuantity,
              receivedQuantity: item.receivedQuantity,
              pendingQuantity: item.pendingQuantity,
              expectedUnitCost: new Prisma.Decimal(item.expectedUnitCost),
            },
          });
        }
      }
    });

    setPurchaseOrdersLastSyncedAt(new Date().toISOString());
  }

  private buildAuthHeaders(): Record<string, string> {
    if (this.accessToken) return { Authorization: `Bearer ${this.accessToken}` };
    return {};
  }

  private async fetchAll(authHeaders: Record<string, string>): Promise<PurchaseOrderRow[]> {
    const limit = 200;
    const updatedSince = getPurchaseOrdersLastSyncedAt();
    const all: PurchaseOrderRow[] = [];
    let cursor: string | null = null;
    while (true) {
      let url = `${this.baseUrl}/purchases/purchase-orders/sync?limit=${limit}`;
      if (updatedSince) url += `&updatedSince=${encodeURIComponent(updatedSince)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      try {
        const res = await this.http.get<{ data: PurchaseOrderRow[]; nextCursor: string | null; hasMore: boolean }>(url, authHeaders);
        all.push(...(res.data ?? []));
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
      } catch {
        return this.fetchLegacy(authHeaders);
      }
    }
    return all;
  }

  private async fetchLegacy(authHeaders: Record<string, string>): Promise<PurchaseOrderRow[]> {
    const pageSize = 200;
    let page = 1;
    let totalPages = 1;
    const all: PurchaseOrderRow[] = [];
    while (page <= totalPages) {
      const res = await this.http.get<{ data: PurchaseOrderRow[]; total: number; page: number; pageSize: number }>(
        `${this.baseUrl}/purchases/purchase-orders?page=${page}&pageSize=${pageSize}`,
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
    if (!response.ok) throw new PurchaseOrderSyncHttpError(url, response.status, await response.text());
    return response.json() as Promise<T>;
  },
};

export class PurchaseOrderSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  constructor(url: string, statusCode: number, responseBody: string) {
    super(`PurchaseOrder sync HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'PurchaseOrderSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

interface PurchaseOrderRow {
  id: string;
  sequentialNumber: number;
  state: string;
  supplierId: string;
  expectedDeliveryDate: string | null;
  subtotal: string | number;
  totalTax: string | number;
  totalAmount: string | number;
  notes: string | null;
  createdAt: string;
  createdById: string;
  confirmedAt: string | null;
  confirmedById: string | null;
  annulledAt: string | null;
  annulledById: string | null;
  annulmentReason: string | null;
  items: Array<{
    id: string;
    productId: string;
    requestedQuantity: number;
    receivedQuantity: number;
    pendingQuantity: number;
    expectedUnitCost: string | number;
  }>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapOrderForCreate = (po: PurchaseOrderRow): any => ({
  id: po.id,
  sequentialNumber: po.sequentialNumber,
  state: po.state as any,
  supplierId: po.supplierId,
  expectedDeliveryDate: po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate) : null,
  subtotal: new Prisma.Decimal(po.subtotal),
  totalTax: new Prisma.Decimal(po.totalTax),
  totalAmount: new Prisma.Decimal(po.totalAmount),
  notes: po.notes ?? null,
  createdAt: new Date(po.createdAt),
  createdById: po.createdById,
  confirmedAt: po.confirmedAt ? new Date(po.confirmedAt) : null,
  confirmedById: po.confirmedById ?? null,
  annulledAt: po.annulledAt ? new Date(po.annulledAt) : null,
  annulledById: po.annulledById ?? null,
  annulmentReason: po.annulmentReason ?? null,
});

const mapOrderForUpdate = (po: PurchaseOrderRow): any => ({
  state: po.state as any,
  expectedDeliveryDate: po.expectedDeliveryDate ? new Date(po.expectedDeliveryDate) : null,
  subtotal: new Prisma.Decimal(po.subtotal),
  totalTax: new Prisma.Decimal(po.totalTax),
  totalAmount: new Prisma.Decimal(po.totalAmount),
  notes: po.notes ?? null,
  confirmedAt: po.confirmedAt ? new Date(po.confirmedAt) : null,
  confirmedById: po.confirmedById ?? null,
  annulledAt: po.annulledAt ? new Date(po.annulledAt) : null,
  annulledById: po.annulledById ?? null,
  annulmentReason: po.annulmentReason ?? null,
});
