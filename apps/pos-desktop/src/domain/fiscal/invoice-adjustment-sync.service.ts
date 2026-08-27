/**
 * Invoice-adjustment pull synchronizer — hydrates local InvoiceLocalAdjustment
 * from server FiscalDocument adjustments so cross-workstation CLIENT_CHANGE
 * etc appear on every device. Server stores them via INVOICE_ADJUSTMENT sync.
 *
 * Server: GET /fiscal-dian/adjustments/sync
 *   — walks (createdAt asc, id asc), filters subscriptionId
 */

import { PrismaClient } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import {
  getInvoiceAdjustmentsLastSyncedAt,
  setInvoiceAdjustmentsLastSyncedAt,
} from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';

export interface InvoiceAdjustmentSyncConfig {
  baseUrl: string;
  httpClient?: SyncHttpClient;
  accessToken?: string;
  offlineToken?: string;
}

export const createInvoiceAdjustmentSyncService = (
  prisma: PrismaClient,
  config: InvoiceAdjustmentSyncConfig,
): InvoiceAdjustmentSyncService => new InvoiceAdjustmentSyncService(prisma, config);

export class InvoiceAdjustmentSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly offlineToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: InvoiceAdjustmentSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.offlineToken = config.offlineToken;
  }

  async pullAdjustments(): Promise<void> {
    if (!isOnline()) return;
    const rows = await this.fetchAdjustments();
    await this.applyAdjustments(rows);
  }

  async fetchAdjustments(): Promise<AdjustmentRow[]> {
    return this.fetchAll(this.buildAuthHeaders());
  }

  async applyAdjustments(rows: AdjustmentRow[]): Promise<void> {
    if (rows.length === 0) {
      setInvoiceAdjustmentsLastSyncedAt(new Date().toISOString());
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const adj of rows) {
        // Ensure Invoice FK exists — invoices sync runs just before adjustments
        const invExists = await tx.invoice.findUnique({ where: { id: adj.invoiceId }, select: { id: true } });
        if (!invExists) continue;
        // Ensure previous adjustment FKs exist if set — skip gracefully if chain broken
        // (adjustment will be visible once predecessor lands in next cycle)
        await tx.invoiceLocalAdjustment.upsert({
          where: { id: adj.id },
          create: mapAdjustmentForCreate(adj),
          update: mapAdjustmentForUpdate(adj),
        });
      }
    });

    setInvoiceAdjustmentsLastSyncedAt(new Date().toISOString());
  }

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    if (this.offlineToken) headers['X-Offline-Token'] = this.offlineToken;
    return headers;
  }

  private async fetchAll(authHeaders: Record<string, string>): Promise<AdjustmentRow[]> {
    const limit = 200;
    const updatedSince = getInvoiceAdjustmentsLastSyncedAt();
    const all: AdjustmentRow[] = [];
    let cursor: string | null = null;
    while (true) {
      let url = `${this.baseUrl}/fiscal-dian/adjustments/sync?limit=${limit}`;
      if (updatedSince) url += `&updatedSince=${encodeURIComponent(updatedSince)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      try {
        const res = await this.http.get<{ data: AdjustmentRow[]; nextCursor: string | null; hasMore: boolean }>(url, authHeaders);
        all.push(...(res.data ?? []));
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
      } catch (err: unknown) {
        if (err instanceof AdjustmentSyncHttpError && (err.statusCode === 401 || err.statusCode === 403)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/\b401\b|\b403\b|\bUnauthorized\b|\bForbidden\b/i.test(msg)) throw err;
        break;
      }
    }
    return all;
  }
}

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new AdjustmentSyncHttpError(url, response.status, await response.text());
    return response.json() as Promise<T>;
  },
};

export class AdjustmentSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  constructor(url: string, statusCode: number, responseBody: string) {
    super(`InvoiceAdjustment sync HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'AdjustmentSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

interface AdjustmentRow {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  previousValue: unknown | null;
  newValue: unknown | null;
  reason: string;
  version: number;
  reversalOfAdjustmentId: string | null;
  replacedByAdjustmentId: string | null;
  createdByUserId: string;
  createdByUserName: string;
  workstationId: string;
  createdAt: string;
  subscriptionId: string;
  adjustmentType: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapAdjustmentForCreate = (r: AdjustmentRow): any => ({
  id: r.id,
  invoiceId: r.invoiceId,
  invoiceNumber: r.invoiceNumber,
  previousValue: r.previousValue as any ?? null,
  newValue: r.newValue as any ?? null,
  reason: r.reason ?? '',
  version: r.version,
  reversalOfAdjustmentId: r.reversalOfAdjustmentId ?? null,
  replacedByAdjustmentId: r.replacedByAdjustmentId ?? null,
  createdByUserId: r.createdByUserId,
  createdByUserName: r.createdByUserName ?? '',
  workstationId: r.workstationId ?? 'unknown',
  createdAt: new Date(r.createdAt),
  adjustmentType: r.adjustmentType as any,
});

const mapAdjustmentForUpdate = (r: AdjustmentRow): any => ({
  invoiceNumber: r.invoiceNumber,
  previousValue: r.previousValue as any ?? null,
  newValue: r.newValue as any ?? null,
  reason: r.reason ?? '',
  version: r.version,
  reversalOfAdjustmentId: r.reversalOfAdjustmentId ?? null,
  replacedByAdjustmentId: r.replacedByAdjustmentId ?? null,
  createdByUserId: r.createdByUserId,
  createdByUserName: r.createdByUserName ?? '',
  workstationId: r.workstationId ?? 'unknown',
  createdAt: new Date(r.createdAt),
  adjustmentType: r.adjustmentType as any,
});
