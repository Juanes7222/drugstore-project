/**
 * Domain types for tenant configuration.
 *
 * Re-exports shared types and adds local types specific to
 * the POS desktop's config computation and UI needs.
 */

import type {
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
  WorkstationConfig,
  NamedPreset,
  ConfigChangelogEntry,
  TenantConfigSyncPayload,
  UserPreferences,
} from '@pharmacy/shared-types';

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
  WorkstationConfig,
  NamedPreset,
  ConfigChangelogEntry,
  TenantConfigSyncPayload,
  UserPreferences,
};

// ---------------------------------------------------------------------------
// Local helper types
// ---------------------------------------------------------------------------

/** Effective config after merging preset + overrides + custom fields. */
export interface EffectiveConfig {
  strictness: StrictnessConfig;
  fiscal: FiscalConfig;
  workflow: WorkflowConfig;
  customCompanyFields: CustomCompanyField[];
  customStrictnessToggles: CustomStrictnessToggle[];
  activePresetCode: PresetCode | null;
  configVersion: number;
}

/** Tracks which fields differ from the active preset. */
export type OverrideMap = Record<string, boolean>;

/** Field requirement category for UI display. */
export type FieldRequirement = 'REQUIRED' | 'OPTIONAL' | 'HIDDEN';

/** Keyboard layout preference. */
export type KeyboardLayout = 'STANDARD' | 'COMPACT';

/** Validation error returned by the domain validation functions. */
export interface ConfigValidationError {
  path: string;
  message: string;
  code: string;
}

/** Result of applying a preset or overriding a toggle. */
export interface ConfigApplyResult {
  effective: EffectiveConfig;
  changedFields: string[];
  overrides: OverrideMap;
}
