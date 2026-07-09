/**
 * Configuration synchronizer for the POS desktop.
 *
 * Makes a single HTTP call to `GET /configuration/pos-settings` and
 * distributes the received payload:
 *
 * 1. Payment methods → `PaymentMethodSyncService.syncPaymentMethods()`
 *    (transactional upsert into local PGlite)
 * 2. Discount limits, alert thresholds, sync defaults →
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
  cashier: RoleDiscountLimitPayload;
  admin: RoleDiscountLimitPayload;
  inventoryAssistant: RoleDiscountLimitPayload;
  accountant: RoleDiscountLimitPayload;
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
   * 1. Fetches `GET /configuration/pos-settings`.
   * 2. Upserts payment methods into the local database (transactional).
   * 3. Hydrates the Zustand store with the rest of the payload.
   *
   * Safe to call when offline — returns early without throwing.
   * If the HTTP call succeeds but the Prisma transaction fails, the
   * Zustand store is NOT updated (no partial state).
   */
  async pullConfiguration(): Promise<void> {
    if (!isOnline()) return;

    const authHeaders = this.buildAuthHeaders();
    const payload = await this.http.get<PosSettingsPayload>(
      `${this.baseUrl}/configuration/pos-settings`,
      authHeaders,
    );

    // Step 1: upsert payment methods inside a transaction
    // If this throws, the Zustand store is never touched.
    await this.paymentMethodSync.syncPaymentMethods(payload.paymentMethods);

    // Step 2: update the persistent local config store
    useLocalConfigStore.getState().hydrateFromServer({
      discountLimits: payload.discountLimits,
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