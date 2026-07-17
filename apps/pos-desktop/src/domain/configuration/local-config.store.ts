/**
 * Persistent local configuration store for the POS desktop.
 *
 * Uses Zustand with `localStorage` persistence to hold business-rule
 * values that the POS needs to operate offline:
 *
 * - `discountLimits` — maximum discount percentages per role
 * - `alertThresholds` — global alert settings (expiry, low-stock)
 * - `syncDefaults` — sync-engine tuning parameters
 * - `sellerInfo` — pharmacy/tenant identity for receipts and invoices
 *
 * ## Safe defaults
 * Every value has a hardcoded fallback so the POS can launch with no
 * prior sync and never crash.  Cashier discount limits are intentionally
 * conservative (10 % item / 5 % global) to prevent accidental overrides.
 * Seller info defaults to "Farmacia" / empty NIT — override via sync.
 *
 * ## Usage
 * ```ts
 * import { useLocalConfigStore } from './local-config.store';
 *
 * const limits = useLocalConfigStore.getState().discountLimits;
 * const cashierItemMax = limits.cashier.itemMaxPercent;  // 10 by default
 * const seller = useLocalConfigStore.getState().sellerInfo;
 * ```
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RoleDiscountLimit {
  itemMaxPercent: number;
  globalMaxPercent: number;
}

export interface DiscountLimits {
  cashier: RoleDiscountLimit;
  admin: RoleDiscountLimit;
  inventoryAssistant: RoleDiscountLimit;
  accountant: RoleDiscountLimit;
}

export interface AlertThresholds {
  expirationWarningDays: number;
  lowStockAlertEnabled: boolean;
}

export interface SyncDefaults {
  batchSize: number;
  maxRetryAttempts: number;
  retryDelaysSeconds: number[];
}

/**
 * Seller/tenant identity displayed on receipts and invoices.
 * Matches the InvoiceSeller shape from fiscal-types for consistency.
 */
export interface TenantInfo {
  nit: string;
  name: string;
  address: string | null;
  phone: string | null;
  resolutionNumber: string | null;
  resolutionDate: string | null;
  resolutionPrefix: string;
}

export interface HydratePayload {
  discountLimits: DiscountLimits;
  alertThresholds: AlertThresholds;
  syncDefaults: SyncDefaults;
  /** Optional seller/tenant info to persist locally. */
  sellerInfo?: TenantInfo;
}

export interface LocalConfigState {
  discountLimits: DiscountLimits;
  alertThresholds: AlertThresholds;
  syncDefaults: SyncDefaults;
  /** Pharmacy/tenant identity for receipts and invoices. */
  sellerInfo: TenantInfo;
  /** ISO-8601 timestamp of the last successful configuration pull. */
  lastSyncedAt: string | null;

  /** Replace the entire store with values fetched from the server. */
  hydrateFromServer(payload: HydratePayload): void;
}

// ---------------------------------------------------------------------------
// Safe defaults
// ---------------------------------------------------------------------------

const DEFAULT_DISCOUNT_LIMITS: DiscountLimits = {
  cashier: { itemMaxPercent: 10, globalMaxPercent: 5 },
  admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
  inventoryAssistant: { itemMaxPercent: 15, globalMaxPercent: 10 },
  accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
};

const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  expirationWarningDays: 30,
  lowStockAlertEnabled: true,
};

const DEFAULT_SYNC_DEFAULTS: SyncDefaults = {
  batchSize: 10,
  maxRetryAttempts: 10,
  retryDelaysSeconds: [30, 120, 300, 600, 1800],
};

const DEFAULT_SELLER_INFO: TenantInfo = {
  nit: '000.000.000-0',
  name: 'Farmacia',
  address: null,
  phone: null,
  resolutionNumber: null,
  resolutionDate: null,
  resolutionPrefix: 'FE',
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'pharmacy_local_config';

export const useLocalConfigStore: StoreApi<LocalConfigState> = createStore<
  LocalConfigState
>()(
  persist(
    (set) => ({
      discountLimits: { ...DEFAULT_DISCOUNT_LIMITS },
      alertThresholds: { ...DEFAULT_ALERT_THRESHOLDS },
      syncDefaults: { ...DEFAULT_SYNC_DEFAULTS },
      sellerInfo: { ...DEFAULT_SELLER_INFO },
      lastSyncedAt: null,

      hydrateFromServer(payload) {
        set({
          discountLimits: payload.discountLimits,
          alertThresholds: payload.alertThresholds,
          syncDefaults: payload.syncDefaults,
          sellerInfo: payload.sellerInfo ?? { ...DEFAULT_SELLER_INFO },
          lastSyncedAt: new Date().toISOString(),
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

/**
 * Reexport the store's state type with a shorthand export for callers that
 * only need the store snapshot (not a React hook).
 */
export const getLocalConfigState = (): LocalConfigState =>
  useLocalConfigStore.getState();

/** Convenience accessor for the seller/tenant identity block. */
export const getTenantInfo = (): TenantInfo =>
  useLocalConfigStore.getState().sellerInfo;