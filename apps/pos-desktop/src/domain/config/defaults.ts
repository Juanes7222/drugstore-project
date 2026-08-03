/**
 * Default values for all tenant config fields.
 *
 * Used when:
 * - Initializing a fresh config for a new subscription
 * - Falling back when a config field is missing
 * - Computing effective config when no preset is selected
 */

import type {
  StrictnessConfig,
  FiscalConfig,
  WorkflowConfig,
  PurchasesConfig,
  CustomCompanyField,
  CustomStrictnessToggle,
  DeliveryConfig,
} from './types';

// ---------------------------------------------------------------------------
// Default strictness
// ---------------------------------------------------------------------------

export const DEFAULT_STRICTNESS: StrictnessConfig = {
  stockValidation: 'WARN',
  clientRequired: 'ABOVE_AMOUNT',
  clientRequiredThreshold: 50000,
  prescriptionEnforcement: 'STRICT',
  inventoryAdjustmentReason: 'OPTIONAL',
  returnsRequireOriginalSale: 'STRICT',
  cashShiftRequired: true,
  receiptPrintRequired: 'STRICT',
  autoOpenDrawer: 'CASH_ONLY',
  customerDisplayRequired: false,
  prescriptionExpiryDays: 180,
};

// ---------------------------------------------------------------------------
// Default fiscal
// ---------------------------------------------------------------------------

export const DEFAULT_FISCAL: FiscalConfig = {
  companyName: '',
  nit: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  logoPath: null,
  taxRegime: 'RESPONSABLE_IVA',
  defaultTaxRate: 0.19,
  additionalTaxes: [],
  invoiceHeader: '',
  invoiceFooter: '',
  dianResolutionNumber: '',
  dianResolutionDate: '',
  dianResolutionPrefix: '',
  dianTechnicalKey: '',
  invoiceNumberFormat: '{prefix}-{number:08d}',
  showLogoOnReceipt: true,
  showQrOnReceipt: true,
  qrContent: 'CUFE_AND_TOTAL',
  qrCustomContent: null,
};

// ---------------------------------------------------------------------------
// Default delivery (domicilio) policy
// ---------------------------------------------------------------------------

/**
 * Default delivery handling policy. The feature is OFF by default — a
 * tenant must enable it explicitly in configuration.
 */
export const DEFAULT_DELIVERY: DeliveryConfig = {
  enabled: false,
  requiresClient: false,
  addressRequired: true,
  phoneRequired: false,
  allowScheduling: false,
  deliveryFeeMode: 'DISABLED',
  fixedDeliveryFeeCents: 0,
  maxDeliveryFeeCents: 0,
  printOnReceipt: true,
  enableStatusTracking: false,
};

// ---------------------------------------------------------------------------
// Default workflow
// ---------------------------------------------------------------------------

export const DEFAULT_WORKFLOW: WorkflowConfig = {
  defaultPaymentMethodId: null,
  autoPrintOnConfirm: true,
  autoOpenDrawerOnConfirm: 'CASH_ONLY',
  printDuplicateReceipt: false,
  requireShiftOpenForSale: true,
  maxOfflineLoginDays: 30,
  sessionIdleTimeoutSeconds: 600,
  sessionIdleTimeouts: { cashier: 600, manager: 1800, owner: 3600 },
  suggestionEngineEnabled: true,
  autoReprintLastReceiptOnReprint: true,
  delivery: DEFAULT_DELIVERY,
};

// ---------------------------------------------------------------------------
// Default purchases config
// ---------------------------------------------------------------------------

export const DEFAULT_PURCHASES: PurchasesConfig = {
  autoConfirmOnCreate: false,
  requireManagerPinForConfirm: false,
  requireManagerPinForAnnul: false,
  requireLotOnReception: false,
  requireExpiryOnReception: false,
  allowOverReception: false,
  defaultPaymentTermsDays: 30,
  maxItemsPerOrder: 0,
};

// ---------------------------------------------------------------------------
// Empty arrays for custom fields
// ---------------------------------------------------------------------------

export const EMPTY_CUSTOM_FIELDS: CustomCompanyField[] = [];
export const EMPTY_CUSTOM_TOGGLES: CustomStrictnessToggle[] = [];
