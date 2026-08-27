/**
 * Invoice pull synchronizer — hydrates local Invoice from server FiscalDocuments.
 *
 * Server: GET /fiscal-dian/invoices/sync (FiscalDocumentsService.findSync)
 *   — walks (updatedAt asc, id asc), filters subscriptionId, optional updatedSince
 *   — shape { data: InvoiceRow[], nextCursor, hasMore } mapped from FiscalDocument
 *
 * Local: upsert Invoice by id. Sales must be hydrated first (FK saleId).
 */

import { PrismaClient } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import {
  getInvoicesLastSyncedAt,
  setInvoicesLastSyncedAt,
} from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';

export interface InvoiceSyncConfig {
  baseUrl: string;
  httpClient?: SyncHttpClient;
  accessToken?: string;
  offlineToken?: string;
}

export const createInvoiceSyncService = (
  prisma: PrismaClient,
  config: InvoiceSyncConfig,
): InvoiceSyncService => new InvoiceSyncService(prisma, config);

export class InvoiceSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly offlineToken?: string;

  constructor(
    private readonly prisma: PrismaClient,
    config: InvoiceSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.offlineToken = config.offlineToken;
  }

  async pullInvoices(): Promise<void> {
    if (!isOnline()) return;
    const rows = await this.fetchInvoices();
    await this.applyInvoices(rows);
  }

  async fetchInvoices(): Promise<InvoiceRow[]> {
    return this.fetchAll(this.buildAuthHeaders());
  }

  async applyInvoices(rows: InvoiceRow[]): Promise<void> {
    if (rows.length === 0) {
      setInvoicesLastSyncedAt(new Date().toISOString());
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      for (const inv of rows) {
        if (!inv.saleId) continue;
        const sale = await tx.sale.findUnique({
          where: { id: inv.saleId },
          include: { items: true, payments: { include: { paymentMethod: { select: { name: true, category: true } } } } },
        });
        if (!sale) continue;

        // Enrich synthetic/stub fullData from server (lineItems:[] , totals 0)
        // with real Sale snapshot so fiscal detail shows items, payments, buyer.
        const enrichedFullData = await enrichFullDataIfStub(inv, sale, tx);
        const rowToUpsert = enrichedFullData ? { ...inv, fullData: enrichedFullData } : inv;

        await tx.invoice.upsert({
          where: { id: inv.id },
          create: mapInvoiceForCreate(rowToUpsert as InvoiceRow),
          update: mapInvoiceForUpdate(rowToUpsert as InvoiceRow),
        });
      }
    });

    setInvoicesLastSyncedAt(new Date().toISOString());
  }

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    if (this.offlineToken) headers['X-Offline-Token'] = this.offlineToken;
    return headers;
  }

  private async fetchAll(authHeaders: Record<string, string>): Promise<InvoiceRow[]> {
    const limit = 200;
    const updatedSince = getInvoicesLastSyncedAt();
    const all: InvoiceRow[] = [];
    let cursor: string | null = null;
    while (true) {
      let url = `${this.baseUrl}/fiscal-dian/invoices/sync?limit=${limit}`;
      if (updatedSince) url += `&updatedSince=${encodeURIComponent(updatedSince)}`;
      if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;
      try {
        const res = await this.http.get<{ data: InvoiceRow[]; nextCursor: string | null; hasMore: boolean }>(url, authHeaders);
        all.push(...(res.data ?? []));
        if (!res.hasMore || !res.nextCursor) break;
        cursor = res.nextCursor;
      } catch (err: unknown) {
        if (err instanceof InvoiceSyncHttpError && (err.statusCode === 401 || err.statusCode === 403)) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        if (/\b401\b|\b403\b|\bUnauthorized\b|\bForbidden\b/i.test(msg)) throw err;
        // Server without sync endpoint — nothing to fallback to, return what we have
        break;
      }
    }
    return all;
  }
}

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new InvoiceSyncHttpError(url, response.status, await response.text());
    return response.json() as Promise<T>;
  },
};

export class InvoiceSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;
  constructor(url: string, statusCode: number, responseBody: string) {
    super(`Invoice sync HTTP error ${statusCode} for ${url}: ${responseBody}`);
    this.name = 'InvoiceSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

interface InvoiceRow {
  id: string;
  saleId: string | null;
  workstationId: string;
  invoiceType: string;
  invoiceNumber: string;
  contingencyNumber: string | null;
  status: string;
  cufeProvisional: string;
  cufeOfficial: string | null;
  issuedAt: string;
  transmittedAt: string | null;
  expiresAt: string | null;
  updatedAt?: string;
  fiscalXml: string | null;
  relatedInvoiceId: string | null;
  contingencyEventId: string | null;
  techKeySnapshot: string | null;
  fullData: unknown;
}

async function enrichFullDataIfStub(inv: InvoiceRow, sale: any, tx: any): Promise<unknown | null> {
  const fd: any = inv.fullData as any;
  const hasItems = Array.isArray(fd?.lineItems) && fd.lineItems.length > 0;
  const hasPayments = Array.isArray(fd?.payments) && fd.payments.length > 0;
  const hasBuyer = !!fd?.buyer?.name;
  if (hasItems && hasPayments && hasBuyer) return null; // already complete

  // Build fallback from Sale snapshot + Client
  let client: any = null;
  if (sale.clientId) {
    try {
      client = await tx.client.findUnique({ where: { id: sale.clientId } });
    } catch {
      client = null;
    }
  }

  const lineItems = (sale.items ?? []).map((it: any) => ({
    productId: it.productId,
    internalCode: it.productInternalCodeSnapshot ?? it.productId,
    commercialName: it.productCommercialNameSnapshot ?? '',
    genericName: it.productGenericNameSnapshot ?? null,
    concentration: it.productConcentrationSnapshot ?? null,
    quantity: it.quantity,
    unitPrice: it.unitPrice?.toString?.() ?? String(it.unitPrice ?? '0'),
    discountPercentage: it.discountPercentage?.toString?.() ?? '0',
    discountAmount: it.discountAmount?.toString?.() ?? '0',
    discountReason: it.discountReason ?? null,
    taxRate: it.taxRate?.toString?.() ?? '0',
    taxAmount: it.taxAmount?.toString?.() ?? '0',
    subtotal: it.subtotal?.toString?.() ?? '0',
    total: it.total?.toString?.() ?? '0',
  }));

  const payments = (sale.payments ?? []).map((p: any) => ({
    paymentMethodId: p.paymentMethodId,
    paymentMethodName: p.paymentMethod?.name ?? 'Desconocido',
    amount: p.amount?.toString?.() ?? String(p.amount ?? '0'),
    category: p.paymentMethod?.category ?? 'OTHER',
    transactionReference: p.transactionReference ?? null,
    authorizationCode: p.authorizationCode ?? null,
    cardBrand: p.cardBrand ?? null,
    cardLastFour: p.cardLastFour ?? null,
  }));

  // Merge server synthetic totals with sale totals when server totals are 0
  const totalsZero = fd?.totalAmount === '0' || fd?.totalAmount === 0 || fd?.totalAmount === '0.00';
  return {
    invoiceType: fd?.invoiceType ?? normalizeInvoiceType(inv.invoiceType),
    invoiceNumber: fd?.invoiceNumber ?? inv.invoiceNumber,
    contingencyNumber: fd?.contingencyNumber ?? inv.contingencyNumber ?? null,
    relatedInvoiceNumber: fd?.relatedInvoiceNumber ?? null,
    seller: fd?.seller ?? { nit: '', name: '', address: null, phone: null, resolutionNumber: null, resolutionDate: null, resolutionPrefix: 'FE' },
    buyer: hasBuyer ? fd.buyer : {
      identificationType: sale.clientIdentificationTypeSnapshot ?? client?.identificationType ?? null,
      identificationNumber: sale.clientIdentificationNumberSnapshot ?? client?.identificationNumber ?? null,
      name: sale.clientNameSnapshot ?? client?.fullName ?? 'CONSUMIDOR FINAL',
      email: client?.email ?? null,
      phone: client?.phone ?? null,
      address: client?.address ?? null,
    },
    lineItems: hasItems ? fd.lineItems : lineItems,
    taxSummaries: hasItems ? (fd.taxSummaries ?? []) : [],
    payments: hasPayments ? fd.payments : payments,
    subtotal: totalsZero ? (sale.subtotal?.toString?.() ?? String(sale.subtotal)) : (fd?.subtotal ?? sale.subtotal?.toString?.()),
    totalDiscount: totalsZero ? (sale.totalDiscount?.toString?.() ?? '0') : (fd?.totalDiscount ?? '0'),
    totalTax: totalsZero ? (sale.totalTax?.toString?.() ?? '0') : (fd?.totalTax ?? '0'),
    totalAmount: totalsZero ? (sale.totalAmount?.toString?.() ?? '0') : (fd?.totalAmount ?? sale.totalAmount?.toString?.()),
    changeAmount: fd?.changeAmount ?? sale.changeAmount?.toString?.() ?? '0',
    issuedAt: fd?.issuedAt ?? new Date(inv.issuedAt).toISOString(),
    currency: fd?.currency ?? 'COP',
    prescriptionNumber: fd?.prescriptionNumber ?? null,
    workstationCode: fd?.workstationCode ?? (inv.workstationId ?? '').slice(0, 8),
  };
}

function normalizeInvoiceType(raw: string): string {
  const v = raw?.toUpperCase?.() ?? '';
  if (v === 'INVOICE') return 'ELECTRONIC_INVOICE';
  if (v === 'CREDIT_NOTE' || v === 'DEBIT_NOTE' || v === 'SUPPORT_DOCUMENT' || v === 'CONTINGENCY_CANCELLATION' || v === 'ELECTRONIC_INVOICE') return v;
  return 'ELECTRONIC_INVOICE';
}
function normalizeInvoiceStatus(raw: string): string {
  const v = raw?.toUpperCase?.() ?? '';
  if (['CONTINGENCY_PENDING_TRANSMISSION', 'TRANSMITTED_AUTHORIZED', 'TRANSMITTED_REJECTED', 'EXPIRED_CONTINGENCY', 'CANCELLED'].includes(v)) return v;
  if (v === 'PENDING_GENERATION') return 'CONTINGENCY_PENDING_TRANSMISSION';
  if (v === 'VALIDATED') return 'TRANSMITTED_AUTHORIZED';
  if (v === 'REJECTED') return 'TRANSMITTED_REJECTED';
  if (v === 'ANNULLED') return 'CANCELLED';
  return 'CONTINGENCY_PENDING_TRANSMISSION';
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapInvoiceForCreate = (r: InvoiceRow): any => ({
  id: r.id,
  saleId: r.saleId ?? ('' as any),
  workstationId: r.workstationId ?? 'unknown',
  invoiceType: normalizeInvoiceType(r.invoiceType) as any,
  invoiceNumber: r.invoiceNumber ?? `INV-${r.id.slice(0, 8)}`,
  contingencyNumber: r.contingencyNumber ?? null,
  status: normalizeInvoiceStatus(r.status) as any,
  cufeProvisional: r.cufeProvisional ?? r.cufeOfficial ?? 'pending',
  cufeOfficial: r.cufeOfficial ?? null,
  issuedAt: new Date(r.issuedAt),
  transmittedAt: r.transmittedAt ? new Date(r.transmittedAt) : null,
  expiresAt: r.expiresAt ? new Date(r.expiresAt) : new Date(Date.now() + 48 * 60 * 60 * 1000),
  fiscalXml: r.fiscalXml ?? null,
  relatedInvoiceId: r.relatedInvoiceId ?? null,
  contingencyEventId: r.contingencyEventId ?? null,
  techKeySnapshot: r.techKeySnapshot ?? 'DEFAULT-TECH-KEY',
  fullData: (r.fullData as any) ?? {},
});

const mapInvoiceForUpdate = (r: InvoiceRow): any => ({
  workstationId: r.workstationId ?? 'unknown',
  invoiceType: normalizeInvoiceType(r.invoiceType) as any,
  invoiceNumber: r.invoiceNumber ?? `INV-${r.id.slice(0, 8)}`,
  contingencyNumber: r.contingencyNumber ?? null,
  status: normalizeInvoiceStatus(r.status) as any,
  cufeProvisional: r.cufeProvisional ?? r.cufeOfficial ?? 'pending',
  cufeOfficial: r.cufeOfficial ?? null,
  issuedAt: new Date(r.issuedAt),
  transmittedAt: r.transmittedAt ? new Date(r.transmittedAt) : null,
  expiresAt: r.expiresAt ? new Date(r.expiresAt) : new Date(Date.now() + 48 * 60 * 60 * 1000),
  fiscalXml: r.fiscalXml ?? null,
  relatedInvoiceId: r.relatedInvoiceId ?? null,
  contingencyEventId: r.contingencyEventId ?? null,
  techKeySnapshot: r.techKeySnapshot ?? 'DEFAULT-TECH-KEY',
  fullData: (r.fullData as any) ?? {},
});
