/**
 * Local report in-memory cache.
 *
 * Cache key = `${reportCode}::${stableHash(filters)}::${userId}::${dbRevision}`.
 * TTL is per-report (configured in the catalog).
 *
 * The cache is *bypassed* on every relevant local mutation.  Domain
 * services call `invalidateCategory(category)` from their
 * post-mutation code paths so reports never serve stale figures after
 * the underlying business data changes.  This is intentionally
 * narrower than a global "invalidate everything" flag.
 */

import type { ReportCode, ReportFreshness, ReportResponse } from './report-types';
import type { ReportCategory } from './report-types';

interface CacheEntry {
  response: ReportResponse;
  expiresAt: number;
}

const CATEGORY_BY_REPORT: Record<ReportCode, ReportCategory> = {
  SALES_DAILY_SUMMARY: 'sales',
  SALES_BY_CASHIER: 'sales',
  SALES_BY_PAYMENT_METHOD: 'sales',
  SALES_BY_PRODUCT: 'sales',
  SALES_BY_HOUR: 'sales',
  SALES_BY_WEEKDAY: 'sales',
  INV_CURRENT_STOCK: 'inventory',
  INV_STOCK_BY_CATEGORY: 'inventory',
  INV_EXPIRING_LOTS: 'inventory',
  INV_EXPIRED_WITH_LOSS: 'inventory',
  INV_ROTATION: 'inventory',
  INV_LOW_MOVEMENT: 'inventory',
  INV_MOVEMENTS: 'inventory',
  FISCAL_TAX_SUMMARY: 'fiscal',
  CASH_SHIFT_CLOSE: 'cash_shift',
  AUDIT_SHIFT_VARIANCES: 'cash_shift',
  PROFIT_MARGIN_BY_PRODUCT: 'profitability',
};

export class ReportCacheService {
  private readonly entries = new Map<string, CacheEntry>();

  /**
   * Compose a deterministic cache key.  The filter hash is the
   * sorted-key concatenation of the normalized filter payload.  Two
   * equivalent filters (different key order) hash to the same key.
   */
  buildKey(
    code: ReportCode,
    filters: unknown,
    userId: string | null,
    dbRevision: string,
  ): string {
    return `${code}::${stableHash(filters)}::${userId ?? 'anon'}::${dbRevision}`;
  }

  get(key: string): ReportResponse | null {
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.response;
  }

  set(
    key: string,
    code: ReportCode,
    response: Omit<ReportResponse, 'fromCache'>,
    ttlMs: number,
  ): void {
    if (ttlMs <= 0) return;
    const entry: CacheEntry = {
      response: { ...response, code, fromCache: true },
      expiresAt: Date.now() + ttlMs,
    };
    this.entries.set(key, entry);
  }

  /**
   * Invalidate every cache entry that belongs to the given category.
   * Called by domain services after a relevant mutation completes.
   */
  invalidateCategory(category: ReportCategory): void {
    const codes = Object.entries(CATEGORY_BY_REPORT)
      .filter(([, c]) => c === category)
      .map(([code]) => code);
    for (const key of this.entries.keys()) {
      if (codes.some((code) => key.startsWith(`${code}::`))) {
        this.entries.delete(key);
      }
    }
  }

  /** Drop every cached entry.  Used when the local database revision
   *  cursor advances (a new SyncQueue row was applied). */
  invalidateAll(): void {
    this.entries.clear();
  }

  /** Test/debug — return the live size. */
  size(): number {
    return this.entries.size;
  }
}

/** Stable, FNV-1a-ish hash for a JSON-serialisable value. */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(canonicalise(value));
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i++) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = canonicalise(obj[k]);
        return acc;
      }, {});
  }
  return value;
}

// Re-export for callers that want the freshness helper alongside the
// cache — they share the same revision semantics.
export type { ReportFreshness };
