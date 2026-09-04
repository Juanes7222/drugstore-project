/**
 * Configuration synchronizer for the POS desktop.
 *
 * Makes a single HTTP call to `GET /configuration/pos-settings` and
 * distributes the received payload:
 *
 * 1. Payment methods → `PaymentMethodSyncService.syncPaymentMethods()`
 *    (transactional upsert into local PGlite)
 * 2. Discount limits, sales config, alert thresholds, sync defaults →
 *    `useLocalConfigStore.getState().hydrateFromServer()` (persistent
 *    Zustand store)
 *
 * ## Network-failure safety
 * A fetch error or timeout causes the entire method to throw, which the
 * caller (`sync-scheduler.service.ts`) catches and swallows so the POS
 * continues with its last known good configuration.  No partial write
 * occurs because the Zustand store is updated synchronously after the
 * Prisma transaction commits.
 *
 * ## Shape
 * Follows the same pattern as `CatalogSyncService` / `LotSyncService`:
 * a single `pullConfiguration()` method and a factory function.
 */

import { PrismaClient } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import { PaymentMethodSyncService } from '../catalog/payment-method-sync.service';
import { useLocalConfigStore } from './local-config.store';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';
import type { FiscalNumberingService } from '../fiscal/numbering.service';
import { useCompanySetupStore } from '../company/company.store';

// ---------------------------------------------------------------------------
// Types matching the server's PosSettingsResponse
// ---------------------------------------------------------------------------

export interface PosPaymentMethodPayload {
  id: string;
  internalCode: string;
  name: string;
  dianCode?: string;
  category: string;
  isCash: boolean;
  sortOrder: number;
  isActive: boolean;
}

export interface RoleDiscountLimitPayload {
  itemMaxPercent: number;
  globalMaxPercent: number;
}

export interface DiscountLimitsPayload {
  owner: RoleDiscountLimitPayload;
  manager: RoleDiscountLimitPayload;
  cashier: RoleDiscountLimitPayload;
  admin: RoleDiscountLimitPayload;
  inventoryAssistant: RoleDiscountLimitPayload;
  accountant: RoleDiscountLimitPayload;
}

export interface RolePriceOverridePayload {
  allowed: boolean;
  requireReason: boolean;
}

export interface PriceOverridePermissionsPayload {
  manager: RolePriceOverridePayload;
  cashier: RolePriceOverridePayload;
  inventoryAssistant: RolePriceOverridePayload;
  accountant: RolePriceOverridePayload;
}

export interface PriceFloorConfigPayload {
  enabled: boolean;
  type: 'COST' | 'COST_PLUS_MARGIN';
  minMarginPercent: number;
}

export interface SalesConfigPayload {
  priceOverridePermissions: PriceOverridePermissionsPayload;
  priceFloor: PriceFloorConfigPayload;
  /** Default store-credit limit in COP cents; optional from older servers. */
  defaultCreditLimitCents?: number;
  /** Master switch for store credit; optional from older servers. */
  creditEnabled?: boolean;
}

export interface AlertThresholdsPayload {
  expirationWarningDays: number;
  lowStockAlertEnabled: boolean;
}

export interface SyncDefaultsPayload {
  batchSize: number;
  maxRetryAttempts: number;
  retryDelaysSeconds: number[];
}

/** Seller identity delivered by the server's pos-settings endpoint.
 *  Matches the local `TenantInfo` shape. */
export interface SellerInfoPayload {
  nit: string;
  name: string;
  address: string | null;
  phone: string | null;
  resolutionNumber: string | null;
  resolutionDate: string | null;
  resolutionPrefix: string;
}

export type PosResolutionState =
  | 'ACTIVE'
  | 'EXPIRING'
  | 'EXHAUSTED'
  | 'EXPIRED';

/** Tenant's numbering resolution, delivered so the workstation counters
 *  can be initialized automatically (no manual entry by the manager). */
export interface PosResolutionPayload {
  resolutionNumber: string;
  documentType: string;
  prefix: string;
  rangeFrom: number;
  rangeTo: number;
  validFrom: string;
  validTo: string;
  /** Next number to issue (range start + emitted count). */
  currentConsecutive: number;
  state: PosResolutionState;
}

export interface PosSettingsPayload {
  paymentMethods: PosPaymentMethodPayload[];
  discountLimits: DiscountLimitsPayload;
  /** Optional in payloads from older servers — falls back to defaults. */
  salesConfig?: SalesConfigPayload;
  alertThresholds: AlertThresholdsPayload;
  syncDefaults: SyncDefaultsPayload;
  /**
   * Optional — absent when the server has no tenant context or no issuer
   * config yet. When absent, the local seller identity is preserved
   * instead of being reset to the placeholder.
   */
  sellerInfo?: SellerInfoPayload;
  /**
   * Active numbering resolution, or null when the tenant has none.
   * Absent on JWT-free boots. Drives automatic counter initialization.
   */
  resolution?: PosResolutionPayload | null;
  /**
   * Whether the tenant has an ACTIVE signing certificate on the server.
   * Absent on JWT-free boots or older servers.
   */
  certificateStatus?: 'ACTIVE' | 'NONE';
}

// ---------------------------------------------------------------------------
// Config & factory
// ---------------------------------------------------------------------------

export interface ConfigSyncConfig {
  /** Server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
  /** Optional override of the HTTP client (for testing). */
  httpClient?: SyncHttpClient;
  /** Optional auth token for protected endpoints. */
  accessToken?: string;
  /** Long-lived offline token fallback (X-Offline-Token). */
  offlineToken?: string;
  /**
   * Fiscal numbering service for automatic counter initialization from
   * the tenant's active resolution.
   */
  numberingService?: FiscalNumberingService;
}

/** Minimum interval between automatic "fetch ranges from DIAN" requests. */
const DIAN_RESOLUTION_SYNC_COOLDOWN_MS = 24 * 60 * 60 * 1000;

const DIAN_RESOLUTION_SYNC_STORAGE_KEY =
  'pharmacy_dian_resolution_sync_last_attempt';

export const createConfigSyncService = (
  prisma: PrismaClient,
  config: ConfigSyncConfig,
): ConfigSyncService => {
  return new ConfigSyncService(prisma, config);
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ConfigSyncService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly offlineToken?: string;
  private readonly numberingService?: FiscalNumberingService;
  private readonly paymentMethodSync: PaymentMethodSyncService;

  constructor(
    _prisma: PrismaClient,
    config: ConfigSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.offlineToken = config.offlineToken;
    this.numberingService = config.numberingService;
    this.paymentMethodSync = new PaymentMethodSyncService(_prisma);
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Pull the full configuration payload from the server.
   *
   * Convenience wrapper over `fetchConfiguration` + `applyConfiguration`
   * for callers that do not orchestrate the PGlite write lock themselves.
   * The sync scheduler calls the two phases separately so the HTTP request
   * never holds the lock.
   *
   * Safe to call when offline — returns early without throwing.
   */
  async pullConfiguration(): Promise<void> {
    if (!isOnline()) return;
    const payload = await this.fetchConfiguration();
    await this.applyConfiguration(payload);
  }

  /**
   * Network phase: fetch `GET /configuration/pos-settings`.
   *
   * No database access — safe to run without the PGlite write lock so a
   * slow server response never blocks foreground operations.
   */
  async fetchConfiguration(): Promise<PosSettingsPayload> {
    const authHeaders = this.buildAuthHeaders();
    return this.http.get<PosSettingsPayload>(
      `${this.baseUrl}/configuration/pos-settings`,
      authHeaders,
    );
  }

  /**
   * Apply phase: write the fetched payload locally.
   *
   * 1. Upserts payment methods into the local database (transactional).
   * 2. Hydrates the Zustand store with the rest of the payload.
   *
   * If the Prisma transaction fails, the Zustand store is NOT updated
   * (no partial state). Must run under the PGlite write lock.
   */
  async applyConfiguration(payload: PosSettingsPayload): Promise<void> {
    // Step 1: upsert payment methods inside a transaction
    // If this throws, the Zustand store is never touched.
    await this.paymentMethodSync.syncPaymentMethods(payload.paymentMethods);

    // Step 2: update the persistent local config store
    // Older servers may omit `salesConfig.defaultCreditLimitCents` and
    // `salesConfig.creditEnabled` from the payload. Keep the currently
    // configured local values in that case — the credit policy is a
    // local-only preference and must not be wiped back to the defaults by
    // a config pull from a server that does not know about it.
    const currentSalesConfig = useLocalConfigStore.getState().salesConfig;
    const salesConfig = payload.salesConfig
      ? {
          ...payload.salesConfig,
          defaultCreditLimitCents:
            payload.salesConfig.defaultCreditLimitCents ??
            currentSalesConfig.defaultCreditLimitCents,
          creditEnabled:
            payload.salesConfig.creditEnabled ??
            currentSalesConfig.creditEnabled,
        }
      : undefined;

    useLocalConfigStore.getState().hydrateFromServer({
      discountLimits: payload.discountLimits,
      salesConfig,
      alertThresholds: payload.alertThresholds,
      syncDefaults: payload.syncDefaults,
      sellerInfo: payload.sellerInfo,
    });

    // Step 3: initialize the fiscal counters from the tenant's active
    // resolution. A sync failure must not break the rest of the config
    // pull — the manager can still initialize counters manually.
    const resolution = payload.resolution;
    if (
      resolution &&
      (resolution.state === 'ACTIVE' || resolution.state === 'EXPIRING') &&
      this.numberingService
    ) {
      try {
        await this.numberingService.syncFromResolution({
          prefix: resolution.prefix,
          authorizedStart: resolution.rangeFrom,
          authorizedEnd: resolution.rangeTo,
          nextRegularNumber: resolution.currentConsecutive,
        });
      } catch (error) {
        console.error('[ConfigSyncService] Resolution sync failed:', error);
      }
    }

    // Step 4: when the tenant has no numbering resolution yet, ask the
    // server to fetch it from DIAN (GetNumberingRange). Fire-and-forget
    // with a local cooldown — once the server job applies, the next pull
    // delivers the resolution and step 3 initializes the counters. This is
    // what lets the owner start selling without ever typing a range.
    if (!resolution && this.accessToken) {
      this.requestResolutionSyncFromDian();
    }

    // Step 5: mirror the certificate status so the habilitation checklist
    // can detect that step automatically (the owner never marks it).
    if (payload.certificateStatus) {
      useCompanySetupStore
        .getState()
        .setCertificateActive(payload.certificateStatus === 'ACTIVE');
    }
  }

  /**
   * Ask the server to fetch this tenant's numbering ranges from DIAN.
   *
   * Idempotent server-side; locally rate-limited to one attempt per
   * cooldown window so an un-habilitated contributor doesn't spam DIAN
   * with doomed jobs on every config cycle. Failures are silent by design:
   * the next cycle retries after the cooldown expires.
   */
  private requestResolutionSyncFromDian(): void {
    const now = Date.now();
    const lastAttempt = Number(
      globalThis.localStorage?.getItem(DIAN_RESOLUTION_SYNC_STORAGE_KEY) ?? 0,
    );
    if (now - lastAttempt < DIAN_RESOLUTION_SYNC_COOLDOWN_MS) return;

    try {
      globalThis.localStorage?.setItem(
        DIAN_RESOLUTION_SYNC_STORAGE_KEY,
        String(now),
      );
    } catch {
      // Storage unavailable (private mode) — proceed without cooldown.
    }

    this.http
      .post?.(
        `${this.baseUrl}/fiscal-dian/resolutions/sync-from-dian`,
        {},
        this.buildDianHeaders(),
      )
      ?.catch((error) => {
        console.error(
          '[ConfigSyncService] Resolution sync-from-DIAN request failed:',
          error,
        );
      });
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

  // Keep requestResolutionSyncFromDian in sync — it also needs the fallback header
  private buildDianHeaders(): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.accessToken) h.Authorization = `Bearer ${this.accessToken}`;
    if (this.offlineToken) h['X-Offline-Token'] = this.offlineToken;
    return h;
  }
}

// ---------------------------------------------------------------------------
// Default HTTP client (same pattern as catalog-sync)
// ---------------------------------------------------------------------------

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new ConfigSyncHttpError(url, response.status, await response.text());
    }
    return response.json() as Promise<T>;
  },
};

// ---------------------------------------------------------------------------
// Local error
// ---------------------------------------------------------------------------

export class ConfigSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(url: string, statusCode: number, responseBody: string) {
    super(
      `Configuration sync HTTP error ${statusCode} for ${url}: ${responseBody}`,
    );
    this.name = 'ConfigSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}