/**
 * Persistent local configuration store for the POS desktop.
 *
 * Uses Zustand with `localStorage` persistence to hold business-rule
 * values that the POS needs to operate offline:
 *
 * - `discountLimits` — maximum discount percentages per role
 * - `salesConfig` — price-override permissions and cost floor rules
 * - `alertThresholds` — global alert settings (expiry, low-stock)
 * - `syncDefaults` — sync-engine tuning parameters
 * - `sellerInfo` — pharmacy/tenant identity for receipts and invoices
 *
 * ## Safe defaults
 * Every value has a hardcoded fallback so the POS can launch with no
 * prior sync and never crash.  Cashier discount limits are intentionally
 * conservative (10 % item / 5 % global) to prevent accidental overrides.
 * The cost floor is enabled by default — even the owner cannot sell
 * below cost unless the floor is explicitly disabled in the settings
 * tab.  Seller info defaults to "Farmacia" / empty NIT — override via sync.
 *
 * ## Usage
 * ```ts
 * import { useLocalConfigStore } from './local-config.store';
 *
 * const limits = useLocalConfigStore.getState().discountLimits;
 * const cashierItemMax = limits.cashier.itemMaxPercent;  // 10 by default
 * const sales = useLocalConfigStore.getState().salesConfig;
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
  owner: RoleDiscountLimit;
  manager: RoleDiscountLimit;
  cashier: RoleDiscountLimit;
  admin: RoleDiscountLimit;
  inventoryAssistant: RoleDiscountLimit;
  accountant: RoleDiscountLimit;
}

/** Roles that have configurable discount limits in the settings UI. */
export type DiscountLimitRole =
  | 'owner'
  | 'manager'
  | 'cashier'
  | 'inventoryAssistant'
  | 'accountant';

/**
 * Whether a role is allowed to override the catalog price at sale time,
 * and whether a reason is required to do so.
 *
 * Owners are never listed here — they are implicitly allowed to override
 * any price (subject only to the cost floor).
 */
export interface RolePriceOverride {
  allowed: boolean;
  requireReason: boolean;
}

export interface PriceOverridePermissions {
  manager: RolePriceOverride;
  cashier: RolePriceOverride;
  inventoryAssistant: RolePriceOverride;
  accountant: RolePriceOverride;
}

/** Which strategy is used to compute the minimum allowed sale price. */
export type PriceFloorType = 'COST' | 'COST_PLUS_MARGIN';

/**
 * Sale price floor configuration.
 *
 * The floor is enforced for every role — including the owner — because
 * selling below cost is a business loss the owner would not normally
 * authorise.  The owner can disable the floor from the settings tab if
 * they explicitly want to allow below-cost sales.
 */
export interface PriceFloorConfig {
  enabled: boolean;
  type: PriceFloorType;
  /** Only used when `type === 'COST_PLUS_MARGIN'`. */
  minMarginPercent: number;
}

/**
 * Sales workflow configuration — controls who can override catalog
 * prices, what the minimum allowed sale price is, and the store-credit
 * policy.
 */
export interface SalesConfig {
  priceOverridePermissions: PriceOverridePermissions;
  priceFloor: PriceFloorConfig;
  /**
   * Master switch for store credit. When off, the default limit is not
   * applied to any client (new or existing). Turning it on backfills the
   * default limit onto existing clients that don't have one yet.
   */
  creditEnabled: boolean;
  /**
   * Default store-credit limit in COP cents applied to clients whose
   * credit limit is not set explicitly (new clients and existing clients
   * without a limit, once credit is enabled). 0 = no default limit.
   */
  defaultCreditLimitCents: number;
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
 * Purchase-specific workflow settings.
 * Controls behaviour of purchase orders, receptions, and supplier returns.
 */
export interface PurchasesConfig {
  /** Auto-confirm PO after creation (skip DRAFT). */
  autoConfirmOnCreate: boolean;
  /** Require manager PIN to confirm a purchase order. */
  requireManagerPinForConfirm: boolean;
  /** Require manager PIN to annul a purchase order. */
  requireManagerPinForAnnul: boolean;
  /** Lot number is required on reception items. */
  requireLotOnReception: boolean;
  /** Expiration date is required on reception items. */
  requireExpiryOnReception: boolean;
  /** Allow receiving more than the ordered quantity. */
  allowOverReception: boolean;
  /** Default payment terms (days) when creating a new supplier. */
  defaultPaymentTermsDays: number;
  /** Max items per purchase order (0 = unlimited). */
  maxItemsPerOrder: number;
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
  /** Optional sales configuration (price overrides + cost floor). */
  salesConfig?: SalesConfig;
  /** Optional seller/tenant info to persist locally. */
  sellerInfo?: TenantInfo;
  /** Optional purchase-specific config. */
  purchasesConfig?: PurchasesConfig;
}

export interface LocalConfigState {
  discountLimits: DiscountLimits;
  alertThresholds: AlertThresholds;
  syncDefaults: SyncDefaults;
  /** Sales workflow settings (price overrides + cost floor). */
  salesConfig: SalesConfig;
  /** Pharmacy/tenant identity for receipts and invoices. */
  sellerInfo: TenantInfo;
  /** Purchase-specific workflow settings. */
  purchasesConfig: PurchasesConfig;
  /** ISO-8601 timestamp of the last successful configuration pull. */
  lastSyncedAt: string | null;

  /** Replace the entire store with values fetched from the server. */
  hydrateFromServer(payload: HydratePayload): void;

  /** Merge a partial update into the purchases config. */
  updatePurchasesConfig(partial: Partial<PurchasesConfig>): void;

  /** Replace the entire purchases config with preset values (resets all fields). */
  applyPresetPurchases(presetPurchases: Partial<PurchasesConfig>): void;

  /** Merge a partial update into the sales config. */
  updateSalesConfig(partial: Partial<SalesConfig>): void;

  /** Replace the entire sales config with preset values (resets all fields). */
  applyPresetSales(presetSales: Partial<SalesConfig>): void;
}

// ---------------------------------------------------------------------------
// Safe defaults
// ---------------------------------------------------------------------------

const DEFAULT_DISCOUNT_LIMITS: DiscountLimits = {
  // Owner: effectively unlimited. The cost floor is the only constraint.
  owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
  // Manager: a reasonable cap; owner can tune this in the settings tab.
  manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
  cashier: { itemMaxPercent: 10, globalMaxPercent: 5 },
  admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
  inventoryAssistant: { itemMaxPercent: 15, globalMaxPercent: 10 },
  accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
};

const DEFAULT_PRICE_OVERRIDE_PERMISSIONS: PriceOverridePermissions = {
  // Manager: allowed, reason required.
  manager: { allowed: true, requireReason: true },
  // Cashier: not allowed by default — owner must explicitly opt-in.
  cashier: { allowed: false, requireReason: true },
  inventoryAssistant: { allowed: false, requireReason: true },
  accountant: { allowed: false, requireReason: true },
};

const DEFAULT_PRICE_FLOOR: PriceFloorConfig = {
  enabled: true,
  type: 'COST',
  minMarginPercent: 0,
};

/**
 * Store credit is opt-in via the sales-settings toggle (`creditEnabled`).
 * The default limit below is what the settings input is pre-filled with:
 * it is applied to new clients and backfilled to existing clients without
 * a limit once credit is activated.
 */
export const DEFAULT_CREDIT_LIMIT_CENTS = 100_000_000; // $1.000.000 COP

/** Credit is off until the owner explicitly activates it in the settings. */
const DEFAULT_CREDIT_ENABLED = false;

const DEFAULT_ALERT_THRESHOLDS: AlertThresholds = {
  expirationWarningDays: 30,
  lowStockAlertEnabled: true,
};

const DEFAULT_SYNC_DEFAULTS: SyncDefaults = {
  batchSize: 10,
  maxRetryAttempts: 10,
  retryDelaysSeconds: [30, 120, 300, 600, 1800],
};

const DEFAULT_PURCHASES_CONFIG: PurchasesConfig = {
  autoConfirmOnCreate: false,
  requireManagerPinForConfirm: false,
  requireManagerPinForAnnul: false,
  requireLotOnReception: false,
  requireExpiryOnReception: false,
  allowOverReception: false,
  defaultPaymentTermsDays: 30,
  maxItemsPerOrder: 0,
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
      salesConfig: {
        priceOverridePermissions: {
          manager: { ...DEFAULT_PRICE_OVERRIDE_PERMISSIONS.manager },
          cashier: { ...DEFAULT_PRICE_OVERRIDE_PERMISSIONS.cashier },
          inventoryAssistant: {
            ...DEFAULT_PRICE_OVERRIDE_PERMISSIONS.inventoryAssistant,
          },
          accountant: { ...DEFAULT_PRICE_OVERRIDE_PERMISSIONS.accountant },
        },
        priceFloor: { ...DEFAULT_PRICE_FLOOR },
        creditEnabled: DEFAULT_CREDIT_ENABLED,
        defaultCreditLimitCents: DEFAULT_CREDIT_LIMIT_CENTS,
      },
      sellerInfo: { ...DEFAULT_SELLER_INFO },
      purchasesConfig: { ...DEFAULT_PURCHASES_CONFIG },
      lastSyncedAt: null,

      hydrateFromServer(payload) {
        set({
          discountLimits: payload.discountLimits,
          alertThresholds: payload.alertThresholds,
          syncDefaults: payload.syncDefaults,
          salesConfig: payload.salesConfig ?? {
            priceOverridePermissions: {
              manager: { ...DEFAULT_PRICE_OVERRIDE_PERMISSIONS.manager },
              cashier: { ...DEFAULT_PRICE_OVERRIDE_PERMISSIONS.cashier },
              inventoryAssistant: {
                ...DEFAULT_PRICE_OVERRIDE_PERMISSIONS.inventoryAssistant,
              },
              accountant: { ...DEFAULT_PRICE_OVERRIDE_PERMISSIONS.accountant },
            },
            priceFloor: { ...DEFAULT_PRICE_FLOOR },
            creditEnabled: DEFAULT_CREDIT_ENABLED,
            defaultCreditLimitCents: DEFAULT_CREDIT_LIMIT_CENTS,
          },
          sellerInfo: payload.sellerInfo ?? { ...DEFAULT_SELLER_INFO },
          purchasesConfig: payload.purchasesConfig ?? { ...DEFAULT_PURCHASES_CONFIG },
          lastSyncedAt: new Date().toISOString(),
        });
      },

      updatePurchasesConfig(partial) {
        set((prev) => ({
          purchasesConfig: { ...prev.purchasesConfig, ...partial },
        }));
      },

      applyPresetPurchases(presetPurchases) {
        set({
          purchasesConfig: { ...DEFAULT_PURCHASES_CONFIG, ...presetPurchases },
        });
      },

      updateSalesConfig(partial) {
        set((prev) => ({
          salesConfig: {
            priceOverridePermissions: {
              ...prev.salesConfig.priceOverridePermissions,
              ...partial.priceOverridePermissions,
            },
            priceFloor: {
              ...prev.salesConfig.priceFloor,
              ...partial.priceFloor,
            },
            defaultCreditLimitCents:
              partial.defaultCreditLimitCents ??
              prev.salesConfig.defaultCreditLimitCents,
            creditEnabled:
              partial.creditEnabled ?? prev.salesConfig.creditEnabled,
          },
        }));
      },

      applyPresetSales(presetSales) {
        set({
          salesConfig: {
            priceOverridePermissions: {
              ...DEFAULT_PRICE_OVERRIDE_PERMISSIONS,
              ...presetSales.priceOverridePermissions,
            },
            priceFloor: {
              ...DEFAULT_PRICE_FLOOR,
              ...presetSales.priceFloor,
            },
            defaultCreditLimitCents:
              presetSales.defaultCreditLimitCents ?? DEFAULT_CREDIT_LIMIT_CENTS,
            creditEnabled:
              presetSales.creditEnabled ?? DEFAULT_CREDIT_ENABLED,
          },
        });
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      merge: mergePersistedConfig,
    },
  ),
);

/**
 * Merge strategy for persisted store state (zustand persist `merge`).
 *
 * Mirrors the default shallow merge and adds a one-time migration for
 * older installs that persisted `salesConfig` without the `creditEnabled`
 * flag (only the default limit input existed back then). If such an
 * install already configured a positive default limit, credit is treated
 * as enabled so already-saved clients keep working instead of being
 * silently locked out of store credit.
 */
export function mergePersistedConfig(
  persistedState: unknown,
  currentState: LocalConfigState,
): LocalConfigState {
  const persisted = persistedState as Partial<LocalConfigState> | undefined;
  if (!persisted) return currentState;

  const persistedSales = persisted.salesConfig;
  // `'creditEnabled' in persistedSales` would narrow the else branch to
  // `never`, because `creditEnabled` is a required field on the typed
  // SalesConfig — but older persisted JSON lacks it. hasOwnProperty keeps
  // the legacy check working on real data.
  const hasCreditFlag =
    !!persistedSales &&
    Object.prototype.hasOwnProperty.call(persistedSales, 'creditEnabled');

  let creditEnabled: boolean;
  if (!persistedSales) {
    creditEnabled = currentState.salesConfig.creditEnabled;
  } else if (hasCreditFlag) {
    creditEnabled = Boolean(persistedSales.creditEnabled);
  } else {
    // Legacy persisted salesConfig: no creditEnabled flag existed, so a
    // positive default limit means the owner had already opted in.
    creditEnabled = (persistedSales.defaultCreditLimitCents ?? 0) > 0;
  }

  return {
    ...currentState,
    ...persisted,
    salesConfig: {
      ...currentState.salesConfig,
      ...persistedSales,
      creditEnabled,
    },
  };
}

/**
 * Reexport the store's state type with a shorthand export for callers that
 * only need the store snapshot (not a React hook).
 */
export const getLocalConfigState = (): LocalConfigState =>
  useLocalConfigStore.getState();

/** Convenience accessor for the seller/tenant identity block. */
export const getTenantInfo = (): TenantInfo =>
  useLocalConfigStore.getState().sellerInfo;

/** Convenience accessor for purchase-specific config. */
export const getPurchasesConfig = (): PurchasesConfig =>
  useLocalConfigStore.getState().purchasesConfig;

/** Convenience accessor for the full sales configuration block. */
export const getSalesConfig = (): SalesConfig =>
  useLocalConfigStore.getState().salesConfig;

/** Convenience accessor for the discount limits block. */
export const getDiscountLimits = (): DiscountLimits =>
  useLocalConfigStore.getState().discountLimits;