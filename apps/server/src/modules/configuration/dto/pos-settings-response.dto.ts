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
  owner: RoleDiscountLimit;
  manager: RoleDiscountLimit;
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

export interface RolePriceOverride {
  allowed: boolean;
  requireReason: boolean;
}

export interface PriceOverridePermissions {
  cashier: RolePriceOverride;
  manager: RolePriceOverride;
  inventoryAssistant: RolePriceOverride;
  accountant: RolePriceOverride;
}

export type PriceFloorType = 'COST' | 'COST_PLUS_MARGIN';

export interface PriceFloorConfig {
  enabled: boolean;
  type: PriceFloorType;
  minMarginPercent: number;
}

export interface SalesConfig {
  priceOverridePermissions: PriceOverridePermissions;
  priceFloor: PriceFloorConfig;
}

/**
 * Pharmacy/tenant issuer identity consumed by the POS for receipts and
 * invoices. Mirrors the TenantInfo shape in the POS local-config store so
 * the desktop can hydrate it directly. Resolution data comes from the
 * subscription's most recent ACTIVE FiscalResolution.
 */
export interface SellerInfoPayload {
  nit: string;
  name: string;
  address: string | null;
  phone: string | null;
  resolutionNumber: string | null;
  resolutionDate: string | null;
  resolutionPrefix: string;
}

export interface PosSettingsResponse {
  paymentMethods: PosPaymentMethod[];
  discountLimits: DiscountLimits;
  alertThresholds: AlertThresholds;
  syncDefaults: SyncDefaults;
  salesConfig: SalesConfig;
  /**
   * Issuer identity from FiscalIssuerConfig. Absent while no issuer config
   * exists for the tenant (or when the request carries no tenant context),
   * so older POS builds that do not know the field keep working.
   */
  sellerInfo?: SellerInfoPayload;
}
