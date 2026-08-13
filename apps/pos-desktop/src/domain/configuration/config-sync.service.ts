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

export interface PosSettingsPayload {
  paymentMethods: PosPaymentMethodPayload[];
  discountLimits: DiscountLimitsPayload;
  /** Optional in payloads from older servers — falls back to defaults. */
  salesConfig?: SalesConfigPayload;
  alertThresholds: AlertThresholdsPayload;
  syncDefaults: SyncDefaultsPayload;
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
}

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
  private readonly paymentMethodSync: PaymentMethodSyncService;

  constructor(
    _prisma: PrismaClient,
    config: ConfigSyncConfig,
  ) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
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
    });
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildAuthHeaders(): Record<string, string> {
    if (this.accessToken) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }
    return {};
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