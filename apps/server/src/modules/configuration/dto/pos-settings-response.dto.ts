/**
 * Response type for GET /configuration/pos-settings.
 *
 * This is the structured payload the POS desktop fetches once per sync cycle
 * to keep its local configuration and payment-method cache current.
 */

import type { FiscalDocumentType, ResolutionState } from '@pharmacy/database';

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

/**
 * Active fiscal resolution for the POS to auto-initialize its local
 * numbering counters.
 *
 * The JWT access token carries no workstationId claim, so the payload is
 * built from the subscription's most recent ACTIVE resolution (same source
 * as SellerInfoPayload), not from a per-workstation allocation.
 *
 * `currentConsecutive` is the live counter from the resolution's most recent
 * allocation: it counts documents already issued (0 = none), and the next
 * number to print is `rangeFrom + currentConsecutive`. The
 * FiscalResolution.currentConsecutive column itself is never incremented by
 * the transmission pipeline and must not be used as a starting point.
 */
export interface PosResolutionPayload {
  resolutionNumber: string;
  documentType: FiscalDocumentType;
  prefix: string;
  rangeFrom: number;
  rangeTo: number;
  validFrom: string;
  validTo: string;
  currentConsecutive: number;
  state: ResolutionState;
}

/**
 * Availability of the tenant's DIAN digital certificate for direct signing.
 * ACTIVE when a FiscalCertificate row exists with status ACTIVE; NONE
 * otherwise (EXPIRED/REVOKED/ROTATED do not count).
 */
export type PosCertificateStatus = 'ACTIVE' | 'NONE';

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
  /**
   * Most recent ACTIVE fiscal resolution, with its live consecutive counter.
   * Absent when the request carries no tenant context (JWT-free first boot);
   * null when the tenant has no ACTIVE resolution yet. Additive field: POS
   * builds that predate it can ignore it.
   */
  resolution?: PosResolutionPayload | null;
  /**
   * Whether the tenant has an ACTIVE DIAN digital certificate ready for
   * direct signing. Absent when the request carries no tenant context
   * (JWT-free first boot), same pattern as sellerInfo/resolution. Additive
   * field: POS builds that predate it can ignore it.
   */
  certificateStatus?: PosCertificateStatus;
}
