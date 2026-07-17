/**
 * Preset definitions — pure data.
 *
 * Three opinionated presets (Simple, Balanced, Strict) and the Custom marker.
 * Adding a new preset is as simple as adding another exported constant.
 */

import type { PresetDefinition, StrictnessConfig, WorkflowConfig } from './types';

// ---------------------------------------------------------------------------
// Preset: Simple
// ---------------------------------------------------------------------------

const SIMPLE_STRICTNESS: StrictnessConfig = {
  lots: 'OFF',
  expiryDates: 'OFF',
  stockValidation: 'WARN',
  clientRequired: 'NEVER',
  clientRequiredThreshold: 0,
  prescriptionEnforcement: 'OFF',
  inventoryAdjustmentReason: 'OPTIONAL',
  returnsRequireOriginalSale: 'OFF',
  cashShiftRequired: false,
  receiptPrintRequired: 'OPTIONAL',
  autoOpenDrawer: 'ALWAYS',
  customerDisplayRequired: false,
  prescriptionExpiryDays: 365,
};

const SIMPLE_WORKFLOW: WorkflowConfig = {
  defaultPaymentMethodId: null,
  autoPrintOnConfirm: true,
  autoOpenDrawerOnConfirm: 'ALWAYS',
  printDuplicateReceipt: false,
  requireShiftOpenForSale: false,
  maxOfflineLoginDays: 30,
  sessionIdleTimeoutSeconds: 3600,
  sessionIdleTimeouts: { cashier: 3600, manager: 7200, owner: 14400 },
  suggestionEngineEnabled: false,
  autoReprintLastReceiptOnReprint: false,
};

export const PRESET_SIMPLE: PresetDefinition = {
  code: 'SIMPLE',
  name: 'Simple',
  description:
    'Configuracion minima. Sin lotes, sin fechas de vencimiento, sin cliente obligatorio. Ideal para farmacias pequenas o de barrio con volumen bajo.',
  nameI18nKey: 'config.presets.simple_name',
  descriptionI18nKey: 'config.presets.simple_desc',
  strictness: SIMPLE_STRICTNESS,
  fiscal: {},
  workflow: SIMPLE_WORKFLOW,
};

// ---------------------------------------------------------------------------
// Preset: Balanced (default)
// ---------------------------------------------------------------------------

const BALANCED_STRICTNESS: StrictnessConfig = {
  lots: 'OPTIONAL',
  expiryDates: 'OPTIONAL',
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

const BALANCED_WORKFLOW: WorkflowConfig = {
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
};

export const PRESET_BALANCED: PresetDefinition = {
  code: 'BALANCED',
  name: 'Balanceado',
  description:
    'Configuracion recomendada. Lotes opcionales, cliente obligatorio sobre $50,000, prescripciones estrictas. Balance entre agilidad y control.',
  nameI18nKey: 'config.presets.balanced_name',
  descriptionI18nKey: 'config.presets.balanced_desc',
  strictness: BALANCED_STRICTNESS,
  fiscal: {},
  workflow: BALANCED_WORKFLOW,
};

// ---------------------------------------------------------------------------
// Preset: Strict
// ---------------------------------------------------------------------------

const STRICT_STRICTNESS: StrictnessConfig = {
  lots: 'STRICT',
  expiryDates: 'STRICT',
  stockValidation: 'STRICT',
  clientRequired: 'ALWAYS',
  clientRequiredThreshold: 0,
  prescriptionEnforcement: 'STRICT',
  inventoryAdjustmentReason: 'REQUIRED',
  returnsRequireOriginalSale: 'STRICT',
  cashShiftRequired: true,
  receiptPrintRequired: 'STRICT',
  autoOpenDrawer: 'CASH_ONLY',
  customerDisplayRequired: true,
  prescriptionExpiryDays: 90,
};

const STRICT_WORKFLOW: WorkflowConfig = {
  defaultPaymentMethodId: null,
  autoPrintOnConfirm: true,
  autoOpenDrawerOnConfirm: 'CASH_ONLY',
  printDuplicateReceipt: true,
  requireShiftOpenForSale: true,
  maxOfflineLoginDays: 15,
  sessionIdleTimeoutSeconds: 300,
  sessionIdleTimeouts: { cashier: 300, manager: 900, owner: 1800 },
  suggestionEngineEnabled: true,
  autoReprintLastReceiptOnReprint: true,
};

export const PRESET_STRICT: PresetDefinition = {
  code: 'STRICT',
  name: 'Estricto',
  description:
    'Control total. Lotes obligatorios, cliente siempre requerido, inventario estricto, ajustes con justificacion. Para farmacias que manejan trazabilidad rigurosa.',
  nameI18nKey: 'config.presets.strict_name',
  descriptionI18nKey: 'config.presets.strict_desc',
  strictness: STRICT_STRICTNESS,
  fiscal: {},
  workflow: STRICT_WORKFLOW,
};

// ---------------------------------------------------------------------------
// Preset: Custom marker
// ---------------------------------------------------------------------------

export const PRESET_CUSTOM: PresetDefinition = {
  code: 'CUSTOM',
  name: 'Personalizado',
  description:
    'Configuracion manual completa. Cada valor es definido explicitamente por el administrador.',
  nameI18nKey: 'config.presets.custom_name',
  descriptionI18nKey: 'config.presets.custom_desc',
  strictness: {},
  fiscal: {},
  workflow: {},
};

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

/** Map of preset code to preset definition. */
export const PRESET_MAP: Record<string, PresetDefinition> = {
  SIMPLE: PRESET_SIMPLE,
  BALANCED: PRESET_BALANCED,
  STRICT: PRESET_STRICT,
  CUSTOM: PRESET_CUSTOM,
};

/** Ordered list of preset definitions (for UI display order). */
export const PRESET_LIST: PresetDefinition[] = [
  PRESET_SIMPLE,
  PRESET_BALANCED,
  PRESET_STRICT,
  PRESET_CUSTOM,
];

/**
 * Resolve a PresetDefinition by code.
 * Returns undefined for unknown codes.
 */
export function getPreset(code: string): PresetDefinition | undefined {
  return PRESET_MAP[code];
}
