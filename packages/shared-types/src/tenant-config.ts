// ---------------------------------------------------------------------------
// Tenant Configuration — shared types for server + POS desktop
// ---------------------------------------------------------------------------

// --- Presets ---

export type PresetCode = 'SIMPLE' | 'BALANCED' | 'STRICT' | 'CUSTOM';

// --- Strictness ---

export type StrictnessLevel = 'STRICT' | 'OPTIONAL' | 'OFF';
export type ClientRequirement = 'ALWAYS' | 'ABOVE_AMOUNT' | 'NEVER';
export type StockValidationLevel = 'STRICT' | 'WARN' | 'OFF';
export type PrescriptionEnforcement = 'STRICT' | 'WARN' | 'OFF';
export type ReceiptPrintRequirement = 'STRICT' | 'OPTIONAL' | 'OFF';
export type AutoOpenDrawerSetting = 'ALWAYS' | 'CASH_ONLY' | 'MANUAL';
export type ReturnsOriginalSaleRequirement = 'STRICT' | 'WITH_MANAGER_AUTH' | 'OFF';

export interface StrictnessConfig {
  lots: StrictnessLevel;
  expiryDates: StrictnessLevel;
  stockValidation: StockValidationLevel;
  clientRequired: ClientRequirement;
  clientRequiredThreshold: number; // COP cents
  prescriptionEnforcement: PrescriptionEnforcement;
  inventoryAdjustmentReason: 'REQUIRED' | 'OPTIONAL';
  returnsRequireOriginalSale: ReturnsOriginalSaleRequirement;
  cashShiftRequired: boolean;
  receiptPrintRequired: ReceiptPrintRequirement;
  autoOpenDrawer: AutoOpenDrawerSetting;
  customerDisplayRequired: boolean;
  prescriptionExpiryDays: number;
}

// --- Fiscal ---

export type TaxRegime = 'RESPONSABLE_IVA' | 'NO_RESPONSABLE' | 'SIMPLE' | 'EXENTO';
export type AdditionalTaxType = 'RETE_FUENTE' | 'ICA' | 'OTHER';
export type QrContentType = 'INVOICE_URL' | 'CUFE_AND_TOTAL' | 'CUSTOM';

export interface AdditionalTax {
  name: string;
  rate: number;
  type: AdditionalTaxType;
}

export interface FiscalConfig {
  companyName: string;
  nit: string;
  address: string;
  city: string;
  phone: string;
  email: string;
  logoPath: string | null;
  taxRegime: TaxRegime;
  defaultTaxRate: number;
  additionalTaxes: AdditionalTax[];
  invoiceHeader: string;
  invoiceFooter: string;
  dianResolutionNumber: string;
  dianResolutionDate: string;
  dianResolutionPrefix: string;
  dianTechnicalKey: string; // server-side, NEVER sent to POS
  invoiceNumberFormat: string;
  showLogoOnReceipt: boolean;
  showQrOnReceipt: boolean;
  qrContent: QrContentType;
  qrCustomContent: string | null;
}

// --- Workflow ---

export type WorkflowAutoOpenDrawer = 'ALWAYS' | 'CASH_ONLY' | 'NEVER';

export interface SessionIdleTimeouts {
  cashier: number;
  manager: number;
  owner: number;
}

export interface WorkflowConfig {
  defaultPaymentMethodId: string | null;
  autoPrintOnConfirm: boolean;
  autoOpenDrawerOnConfirm: WorkflowAutoOpenDrawer;
  printDuplicateReceipt: boolean;
  requireShiftOpenForSale: boolean;
  maxOfflineLoginDays: number;
  sessionIdleTimeoutSeconds: number;
  sessionIdleTimeouts: SessionIdleTimeouts;
  suggestionEngineEnabled: boolean;
  autoReprintLastReceiptOnReprint: boolean;
}

// --- Custom fields ---

export type CustomFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'URL' | 'EMAIL';
export type CustomToggleType = 'BOOLEAN' | 'SELECT' | 'AMOUNT';
export type CustomToggleAppliesTo = 'SALE' | 'RETURN' | 'INVENTORY' | 'CLIENT' | 'ALL';

export interface CustomCompanyField {
  id: string;
  name: string;
  key: string;
  type: CustomFieldType;
  value: string | number | Date;
  required: boolean;
  showOnInvoice: boolean;
  showOnReport: boolean;
  order: number;
}

export interface CustomStrictnessToggle {
  id: string;
  name: string;
  key: string;
  description: string;
  type: CustomToggleType;
  defaultValue: boolean | string | number;
  options?: Array<{ label: string; value: string }>;
  appliesTo: CustomToggleAppliesTo;
  isAdvisory: boolean;
}

// --- Preset definitions ---

export interface PresetDefinition {
  code: PresetCode;
  name: string;
  description: string;
  /** i18n key for the preset name (e.g. 'config.presets.simple_name'). */
  nameI18nKey?: string;
  /** i18n key for the preset description (e.g. 'config.presets.simple_desc'). */
  descriptionI18nKey?: string;
  strictness: Partial<StrictnessConfig>;
  fiscal: Partial<FiscalConfig>;
  workflow: Partial<WorkflowConfig>;
}

// --- TenantConfig (persisted to server DB) ---

export interface TenantConfig {
  id: string;
  subscriptionId: string;
  activePresetCode: PresetCode | null; // null = Custom mode
  strictness: StrictnessConfig;
  fiscal: FiscalConfig;
  workflow: WorkflowConfig;
  customCompanyFields: CustomCompanyField[];
  customStrictnessToggles: CustomStrictnessToggle[];
  configVersion: number;
  lastModifiedByUserId: string;
  lastModifiedAt: string;
  createdAt: string;
}

// --- NamedPreset (saved custom configurations for reuse) ---

export interface NamedPreset {
  id: string;
  subscriptionId: string;
  name: string;
  description: string | null;
  strictness: StrictnessConfig;
  fiscal: FiscalConfig;
  workflow: WorkflowConfig;
  customCompanyFields: CustomCompanyField[];
  customStrictnessToggles: CustomStrictnessToggle[];
  isShared: boolean;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
}

// --- ConfigChangelog (audit trail for config changes) ---

export type ConfigChangeType =
  | 'PRESET_APPLIED'
  | 'FIELD_UPDATED'
  | 'CUSTOM_FIELD_ADDED'
  | 'CUSTOM_FIELD_UPDATED'
  | 'CUSTOM_FIELD_REMOVED'
  | 'CUSTOM_TOGGLE_ADDED'
  | 'CUSTOM_TOGGLE_UPDATED'
  | 'CUSTOM_TOGGLE_REMOVED'
  | 'NAMED_PRESET_SAVED'
  | 'NAMED_PRESET_APPLIED'
  | 'ROLLBACK'
  | 'RESET_TO_PRESET';

export interface ConfigChangelogEntry {
  id: string;
  tenantConfigId: string;
  configVersion: number;
  changeType: ConfigChangeType;
  fieldPath: string | null;
  beforeValue: unknown | null;
  afterValue: unknown | null;
  actorUserId: string;
  createdAt: string;
}

// --- Workstation-specific config overrides ---

/**
 * Per-workstation overrides for workflow and non-system strictness fields.
 * Allows workstations to differ in operational preferences (print, drawer,
 * timeouts) while system-level settings (fiscal, tax, compliance) remain
 * global via TenantConfig.
 */
export interface WorkstationConfig {
  id: string;
  subscriptionId: string;
  workstationId: string;
  /** Workstation-level workflow overrides (partial). */
  workflow: Partial<WorkflowConfig>;
  /** Workstation-level strictness overrides (partial, non-system fields only). */
  strictness: Partial<StrictnessConfig>;
  createdAt: string;
  updatedAt: string;
}

// --- Sync payload ---

export interface TenantConfigSyncPayload {
  config: TenantConfig;
  // The sync payload also includes current preset definitions so the POS
  // can always compute effective config without a round-trip
  presets: PresetDefinition[];
  /**
   * Per-workstation config overrides for the requesting workstation.
   * The POS merges these on top of the global config to compute the
   * effective runtime configuration.
   */
  workstationConfig?: WorkstationConfig;
}

// --- User preferences (workstation-local, not synced) ---

export type UserTheme = 'LIGHT' | 'DARK' | 'SYSTEM';
export type DateFormat = 'DD/MM/YYYY' | 'YYYY-MM-DD' | 'MM/DD/YYYY';
export type TimeFormat = '12H' | '24H';
export type Language = 'es' | 'en';

export interface UserPreferences {
  userId: string;
  workstationId: string;
  theme: UserTheme;
  language: Language;
  dateFormat: DateFormat;
  timeFormat: TimeFormat;
  soundEnabled: boolean;
  receiptFontSize: number;
  keyboardLayout: 'STANDARD' | 'COMPACT';
  quickButtons: string[]; // product IDs for quick-select
  lastActiveScreen: string | null;
}
