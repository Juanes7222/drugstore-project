/**
 * Response type for GET /configuration/pos-settings.
 *
 * This is the structured payload the POS desktop fetches once per sync cycle
 * to keep its local configuration and payment-method cache current.
 */

// ---------------------------------------------------------------------------
// Public types (exported for use by POS clients)
// ---------------------------------------------------------------------------

export interface PosPaymentMethod {
  id: string;
  internalCode: string;
  name: string;
  dianCode?: string;
  category: string;
  isCash: boolean;
  sortOrder: number;
  isActive: boolean;
}

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

export interface PosSettingsResponse {
  paymentMethods: PosPaymentMethod[];
  discountLimits: DiscountLimits;
  alertThresholds: AlertThresholds;
  syncDefaults: SyncDefaults;
}