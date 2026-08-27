/**
 * Sales-history pull synchronizer — hydrates local Sale + SaleItem + SalePayment
 * from server's confirmed sales so a new device sees full history.
 *
 * Server: GET /sales-pos/sync?limit=&cursor=&updatedSince=  (SaleService.findSync)
 *   - walks (lastModifiedAt asc, id asc), filters operationalState=CONFIRMED
 *   - include: { items, payments } (lightweight, no fiscal XML)
 *
 * Local: upsert Sale by id, then items/payments by id, delete-orphans.
 * Pattern mirrors CatalogSyncService / LotSyncService (fetch without lock,
 * apply under write lock).
 */

import { PrismaClient, Prisma } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import {
  getSalesLastSyncedAt,
  setSalesLastSyncedAt,
} from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';

export interface SalesSyncConfig {
  baseUrl: string;
  httpClient?: SyncHttpClient;
  accessToken?: string;
  offlineToken?: string;
}

export const createSalesSyncService = (
  prisma: PrismaClient,
  config: SalesSyncConfig,
): SalesSyncService => new SalesSyncService(prisma, config);

export class SalesSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly offlineToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: SalesSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.offlineToken = config.offlineToken;
  }

  /** Convenience wrapper — respects offline. */
  async pullSales(): Promise<void> {
    if (!isOnline()) return;
    const rows = await this.fetchSales();
    await this.applySales(rows);
  }

  /** Network phase — safe without write lock. */
  async fetchSales(): Promise<SaleSyncRow[]> {
    const authHeaders = this.buildAuthHeaders();
    return this.fetchAll(authHeaders);
  }

  /**
   * Apply phase — upsert Sales + children.
   * Must run under PGlite write lock.
   * Skips pull rows that would overwrite a local sale still PENDING/FAILED in SyncQueue
   * (offline sale not yet pushed) — server row is stale until push lands.
   */
  async applySales(rows: SaleSyncRow[]): Promise<void> {
    if (rows.length === 0) {
      setSalesLastSyncedAt(new Date().toISOString());
      return;
    }

    // Collect local pending sale ids to guard against overwrite
    const pendingSaleIds = new Set<string>();
    try {
      const pending = await this.prisma.syncQueue.findMany({
        where: {
          operationType: 'SALE_CONFIRMATION',
          status: { in: ['PENDING', 'FAILED'] },
        },
        select: { payload: true },
      });
      for (const row of pending) {
        try {
          const parsed = JSON.parse(row.payload as string) as { metadata?: { localSaleId?: string } };
          if (parsed.metadata?.localSaleId) pendingSaleIds.add(parsed.metadata.localSaleId);
        } catch {
          // ignore malformed
        }
      }
    } catch {
      // syncQueue table may not exist on very old local DB — ignore
    }

    await this.prisma.$transaction(async (tx) => {
      for (const sale of rows) {
        if (pendingSaleIds.has(sale.id)) continue;

        // Ensure CashShift FK exists — sales on server reference shifts that
        // this workstation never opened. Without stub, FK violation rolls back
        // entire batch and leaves Sale empty (the bug reported: Select * from "Sale" = 0).
        if (sale.cashShiftId) {
          const existingShift = await tx.cashShift.findUnique({ where: { id: sale.cashShiftId }, select: { id: true } });
          if (!existingShift) {
            await tx.cashShift.create({
              data: {
                id: sale.cashShiftId,
                workstationId: sale.workstationId ?? 'unknown',
                userId: sale.userId ?? 'system',
                state: 'CLOSED' as any,
                openedAt: new Date(sale.startedAt),
                closedAt: sale.confirmedAt ? new Date(sale.confirmedAt) : new Date(sale.startedAt),
                openingBalance: new Prisma.Decimal(0),
              },
            });
          }
        }

        // If client referenced does not exist locally yet (client pull hasn't landed
        // or was filtered), null it out to avoid FK violation — snapshots on Sale
        // already preserve display name/ID for history view.
        let clientId = sale.clientId ?? null;
        if (clientId) {
          const clientExists = await tx.client.findUnique({ where: { id: clientId }, select: { id: true } });
          if (!clientExists) clientId = null;
        }

        await tx.sale.upsert({
          where: { id: sale.id },
          create: mapSaleForCreate({ ...sale, clientId } as SaleSyncRow),
          update: mapSaleForUpdate({ ...sale, clientId } as SaleSyncRow),
        });

        // Items — upsert by id, delete orphans not in payload
        const incomingItemIds = new Set(sale.items.map((i) => i.id));
        await tx.saleItem.deleteMany({
          where: { saleId: sale.id, id: { notIn: [...incomingItemIds] } },
        });
        for (const item of sale.items) {
          await tx.saleItem.upsert({
            where: { id: item.id },
            create: {
              id: item.id,
              saleId: sale.id,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
              discountPercentage: new Prisma.Decimal(item.discountPercentage ?? 0),
              discountAmount: new Prisma.Decimal(item.discountAmount ?? 0),
              discountReason: item.discountReason ?? null,
              taxRate: new Prisma.Decimal(item.taxRate ?? 0),
              taxAmount: new Prisma.Decimal(item.taxAmount ?? 0),
              subtotal: new Prisma.Decimal(item.subtotal ?? 0),
              total: new Prisma.Decimal(item.total ?? 0),
              productInternalCodeSnapshot: item.productInternalCodeSnapshot ?? item.productId,
              productCommercialNameSnapshot: item.productCommercialNameSnapshot ?? '',
              productGenericNameSnapshot: item.productGenericNameSnapshot ?? null,
              productConcentrationSnapshot: item.productConcentrationSnapshot ?? null,
            },
            update: {
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
              discountPercentage: new Prisma.Decimal(item.discountPercentage ?? 0),
              discountAmount: new Prisma.Decimal(item.discountAmount ?? 0),
              discountReason: item.discountReason ?? null,
              taxRate: new Prisma.Decimal(item.taxRate ?? 0),
              taxAmount: new Prisma.Decimal(item.taxAmount ?? 0),
              subtotal: new Prisma.Decimal(item.subtotal ?? 0),
              total: new Prisma.Decimal(item.total ?? 0),
            },
          });
        }

        // Payments — same strategy
        const incomingPaymentIds = new Set(sale.payments.map((p) => p.id));
        await tx.salePayment.deleteMany({
          where: { saleId: sale.id, id: { notIn: [...incomingPaymentIds] } },
        });
        for (const p of sale.payments) {
          await tx.salePayment.upsert({
            where: { id: p.id },
            create: {
              id: p.id,
              saleId: sale.id,
              paymentMethodId: p.paymentMethodId,
              amount: new Prisma.Decimal(p.amount),
              transactionReference: p.transactionReference ?? null,
              authorizationCode: p.authorizationCode ?? null,
              cardBrand: p.cardBrand ?? null,
              cardLastFour: p.cardLastFour ?? null,
              batchNumber: p.batchNumber ?? null,
              processorResponseCode: p.processorResponseCode ?? null,
            },
            update: {
              paymentMethodId: p.paymentMethodId,
              amount: new Prisma.Decimal(p.amount),
              transactionReference: p.transactionReference ?? null,
              authorizationCode: p.authorizationCode ?? null,
              cardBrand: p.cardBrand ?? null,
              cardLastFour: p.cardLastFour ?? null,
              batchNumber: p.batchNumber ?? null,
              processorResponseCode: p.processorResponseCode ?? null,
            },
          });
        }
      }
    });

    setSalesLastSyncedAt(new Date().toISOString());
  }

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    if (this.offlineToken) headers['X-Offline-Token'] = this.offlineToken;
    return headers;
  }

  private async fetchAll(authHeaders: Record<string, string>): Promise<SaleSyncRow[]> {
    const limit = 200;
    const updatedSince = getSalesLastSyncedAt();
    const all: SaleSyncRow[] = [];
    let cursor: string | null = null;
    while (true) {
      let url = `${this.baseUrl}/sales-pos/sync?limit=${limit}`;
      if (updatedSince) url += `&updatedSince=${encodeURIComponent(updatedSince)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      try {
        const res = await this.http.get<{ data: SaleSyncRow[]; nextCursor: string | null; hasMore: boolean }>(url, authHeaders);
        all.push(...(res.data ?? []));
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
      } catch (err: unknown) {
        if (err instanceof SalesSyncHttpError && (err.statusCode === 401 || err.statusCode === 403)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/\b401\b|\b403\b|\bUnauthorized\b|\bForbidden\b/i.test(msg)) throw err;
        // Fallback: legacy offset endpoint (paginated, no cursor)
        return this.fetchLegacy(authHeaders);
      }
    }
    return all;
  }

  private async fetchLegacy(authHeaders: Record<string, string>): Promise<SaleSyncRow[]> {
    const pageSize = 100;
    let page = 1;
    let totalPages = 1;
    const all: SaleSyncRow[] = [];
    while (page <= totalPages) {
      const res = await this.http.get<{ data: SaleSyncRow[]; total: number; page: number; pageSize: number }>(
        `${this.baseUrl}/sales-pos?page=${page}&pageSize=${pageSize}`,
        authHeaders,
      );
      all.push(...res.data);
      totalPages = Math.ceil(res.total / res.pageSize);
      page++;
      // Safety cap for legacy full-scan (history could be huge)
      if (page > 50) break;
    }
    return all;
  }
}

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new SalesSyncHttpError(url, response.status, await response.text());
    return response.json() as Promise<T>;
  },
};

export class SalesSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  constructor(url: string, statusCode: number, responseBody: string) {
    super(`Sales sync HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'SalesSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

interface SaleSyncRow {
  id: string;
  localNumber: string | number;
  operationalState: string;
  startedAt: string;
  confirmedAt: string | null;
  lastModifiedAt: string;
  clientId: string | null;
  clientNameSnapshot: string | null;
  clientIdentificationTypeSnapshot: string | null;
  clientIdentificationNumberSnapshot: string | null;
  subtotal: string | number;
  totalDiscount: string | number;
  totalTax: string | number;
  totalAmount: string | number;
  changeAmount: string | number;
  cashShiftId: string;
  workstationId: string;
  userId: string;
  sourceWorkstationId: string;
  delivery: unknown | null;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: string | number;
    discountPercentage: string | number;
    discountAmount: string | number;
    discountReason: string | null;
    taxRate: string | number;
    taxAmount: string | number;
    subtotal: string | number;
    total: string | number;
    productInternalCodeSnapshot: string;
    productCommercialNameSnapshot: string;
    productGenericNameSnapshot: string | null;
    productConcentrationSnapshot: string | null;
  }>;
  payments: Array<{
    id: string;
    paymentMethodId: string;
    amount: string | number;
    transactionReference: string | null;
    authorizationCode: string | null;
    cardBrand: string | null;
    cardLastFour: string | null;
    batchNumber: string | null;
    processorResponseCode: string | null;
  }>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapSaleForCreate = (s: SaleSyncRow): any => ({
  id: s.id,
  localNumber: BigInt(s.localNumber),
  operationalState: s.operationalState as any,
  startedAt: new Date(s.startedAt),
  confirmedAt: s.confirmedAt ? new Date(s.confirmedAt) : null,
  lastModifiedAt: new Date(s.lastModifiedAt ?? s.confirmedAt ?? s.startedAt),
  clientId: s.clientId ?? null,
  clientNameSnapshot: s.clientNameSnapshot ?? null,
  clientIdentificationTypeSnapshot: s.clientIdentificationTypeSnapshot as any ?? null,
  clientIdentificationNumberSnapshot: s.clientIdentificationNumberSnapshot ?? null,
  subtotal: new Prisma.Decimal(s.subtotal),
  totalDiscount: new Prisma.Decimal(s.totalDiscount),
  totalTax: new Prisma.Decimal(s.totalTax),
  totalAmount: new Prisma.Decimal(s.totalAmount),
  changeAmount: new Prisma.Decimal(s.changeAmount ?? 0),
  cashShiftId: s.cashShiftId,
  workstationId: s.workstationId,
  userId: s.userId,
  sourceWorkstationId: s.sourceWorkstationId ?? s.workstationId,
  delivery: (s.delivery as any) ?? Prisma.JsonNull,
});

const mapSaleForUpdate = (s: SaleSyncRow): any => ({
  operationalState: s.operationalState as any,
  confirmedAt: s.confirmedAt ? new Date(s.confirmedAt) : null,
  lastModifiedAt: new Date(s.lastModifiedAt ?? s.confirmedAt ?? s.startedAt),
  clientId: s.clientId ?? null,
  clientNameSnapshot: s.clientNameSnapshot ?? null,
  clientIdentificationTypeSnapshot: s.clientIdentificationTypeSnapshot as any ?? null,
  clientIdentificationNumberSnapshot: s.clientIdentificationNumberSnapshot ?? null,
  subtotal: new Prisma.Decimal(s.subtotal),
  totalDiscount: new Prisma.Decimal(s.totalDiscount),
  totalTax: new Prisma.Decimal(s.totalTax),
  totalAmount: new Prisma.Decimal(s.totalAmount),
  changeAmount: new Prisma.Decimal(s.changeAmount ?? 0),
  delivery: (s.delivery as any) ?? Prisma.JsonNull,
});
