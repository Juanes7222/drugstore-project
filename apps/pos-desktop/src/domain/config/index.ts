/**
 * Domain barrel — config module.
 *
 * Re-exports types and pure functions for the tenant configuration domain.
 */

export type {
  PresetCode,
  StrictnessLevel,
  ClientRequirement,
  StockValidationLevel,
  PrescriptionEnforcement,
  ReceiptPrintRequirement,
  AutoOpenDrawerSetting,
  ReturnsOriginalSaleRequirement,
  TaxRegime,
  AdditionalTaxType,
  QrContentType,
  WorkflowAutoOpenDrawer,
  SessionIdleTimeouts,
  CustomFieldType,
  CustomToggleType,
  CustomToggleAppliesTo,
  ConfigChangeType,
  UserTheme,
  DateFormat,
  TimeFormat,
  Language,
  StrictnessConfig,
  FiscalConfig,
  AdditionalTax,
  WorkflowConfig,
  CustomCompanyField,
  CustomStrictnessToggle,
  PresetDefinition,
  TenantConfig,
  NamedPreset,
  ConfigChangelogEntry,
  TenantConfigSyncPayload,
  UserPreferences,
} from './types';

export type {
  EffectiveConfig,
  OverrideMap,
  FieldRequirement,
  ConfigValidationError,
  ConfigApplyResult,
  KeyboardLayout,
} from './types';

export {
  PRESET_SIMPLE,
  PRESET_BALANCED,
  PRESET_STRICT,
  PRESET_CUSTOM,
  PRESET_MAP,
  PRESET_LIST,
  getPreset,
} from './presets';

export {
  DEFAULT_STRICTNESS,
  DEFAULT_FISCAL,
  DEFAULT_WORKFLOW,
  EMPTY_CUSTOM_FIELDS,
  EMPTY_CUSTOM_TOGGLES,
} from './defaults';

export {
  validateTenantConfig,
  validatePresetCode,
} from './validation';

export {
  computeEffectiveConfig,
  getOverriddenFields,
  hasOverrides,
  isFieldOverridden,
} from './effective-config';

export {
  getLotRequirement,
  getExpiryDateRequirement,
  getStockValidationBehavior,
  getClientRequirement,
  getPrescriptionEnforcementBehavior,
  getAdjustmentReasonRequirement,
  getReturnsOriginalSaleRequirement,
  isCashShiftRequired,
  getReceiptPrintRequirement,
  getAutoOpenDrawerBehavior,
  isCustomerDisplayRequired,
  getPrescriptionExpiryDays,
} from './field-requirements';

export {
  createConfigService,
  createDefaultConfigHttpClient,
  ConfigHttpError,
  type ConfigService,
  type ConfigHttpClient,
  type DefaultConfigHttpClientOptions,
} from './config.service';

export {
  useTenantConfigStore,
  getTenantConfigState,
  type TenantConfigState,
} from './tenant-config.store';

export { useTenantConfig, type UseTenantConfigResult } from './use-tenant-config';
export { useUserPreferences, type UseUserPreferencesResult } from './use-user-preferences';
export {
  useFieldRequirement,
  useFieldRequirementFor,
  type UseFieldRequirementResult,
  type KnownFieldKey,
} from './use-field-requirement';

export {
  createTenantConfigSyncService,
  TenantConfigSyncHttpError,
  type TenantConfigSyncService,
  type TenantConfigSyncConfig,
} from './config-sync.service';
