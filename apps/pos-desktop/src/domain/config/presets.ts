/**
 * Preset definitions — pure data.
 *
 * Three opinionated presets (Simple, Balanced, Strict) and the Custom marker.
 * Adding a new preset is as simple as adding another exported constant.
 */

import type { PresetDefinition, StrictnessConfig, WorkflowConfig } from './types';
import type { PurchasesConfig } from '../../domain/configuration/local-config.store';

// ---------------------------------------------------------------------------
// Preset: Simple
// ---------------------------------------------------------------------------

const SIMPLE_PURCHASES: Partial<PurchasesConfig> = {
  autoConfirmOnCreate: true,
  requireManagerPinForConfirm: false,
  requireManagerPinForAnnul: false,
  requireLotOnReception: false,
  requireExpiryOnReception: false,
  allowOverReception: true,
  defaultPaymentTermsDays: 30,
  maxItemsPerOrder: 0,
};

const SIMPLE_STRICTNESS: StrictnessConfig = {
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

export const PRESET_SIMPLE: PresetDefinition & { purchases: Partial<PurchasesConfig> } = {
  code: 'SIMPLE',
  name: 'Simple',
  description:
    'Configuracion minima. Sin cliente obligatorio, sin justificacion estricta de ajustes. Ideal para farmacias pequenas o de barrio con volumen bajo.',
  nameI18nKey: 'config.presets.simple_name',
  descriptionI18nKey: 'config.presets.simple_desc',
  strictness: SIMPLE_STRICTNESS,
  fiscal: {},
  workflow: SIMPLE_WORKFLOW,
  purchases: SIMPLE_PURCHASES,
};

// ---------------------------------------------------------------------------
// Preset: Balanced (default)
// ---------------------------------------------------------------------------

const BALANCED_STRICTNESS: StrictnessConfig = {
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

const BALANCED_PURCHASES: Partial<PurchasesConfig> = {
  autoConfirmOnCreate: false,
  requireManagerPinForConfirm: false,
  requireManagerPinForAnnul: false,
  requireLotOnReception: true,
  requireExpiryOnReception: true,
  allowOverReception: false,
  defaultPaymentTermsDays: 30,
  maxItemsPerOrder: 50,
};

export const PRESET_BALANCED: PresetDefinition & { purchases: Partial<PurchasesConfig> } = {
  code: 'BALANCED',
  name: 'Balanceado',
  description:
    'Configuracion recomendada. Lotes requeridos en recepcion de compras, cliente obligatorio sobre $50,000, prescripciones estrictas. Balance entre agilidad y control.',
  nameI18nKey: 'config.presets.balanced_name',
  descriptionI18nKey: 'config.presets.balanced_desc',
  strictness: BALANCED_STRICTNESS,
  fiscal: {},
  workflow: BALANCED_WORKFLOW,
  purchases: BALANCED_PURCHASES,
};

// ---------------------------------------------------------------------------
// Preset: Strict
// ---------------------------------------------------------------------------

const STRICT_STRICTNESS: StrictnessConfig = {
  stockValidation: 'STRICT',
  clientRequired: 'ALWAYS',
  clientRequiredThreshold: 0,
  prescriptionEnforcement: 'STRICT',
  inventoryAdjustmentReason: 'STRICT',
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

const STRICT_PURCHASES: Partial<PurchasesConfig> = {
  autoConfirmOnCreate: false,
  requireManagerPinForConfirm: true,
  requireManagerPinForAnnul: true,
  requireLotOnReception: true,
  requireExpiryOnReception: true,
  allowOverReception: false,
  defaultPaymentTermsDays: 15,
  maxItemsPerOrder: 20,
};

export const PRESET_STRICT: PresetDefinition & { purchases: Partial<PurchasesConfig> } = {
  code: 'STRICT',
  name: 'Estricto',
  description:
    'Control total. Lotes y fechas de vencimiento obligatorios en recepcion de compras, cliente siempre requerido, inventario estricto, ajustes con justificacion. Para farmacias que manejan trazabilidad rigurosa.',
  nameI18nKey: 'config.presets.strict_name',
  descriptionI18nKey: 'config.presets.strict_desc',
  strictness: STRICT_STRICTNESS,
  fiscal: {},
  workflow: STRICT_WORKFLOW,
  purchases: STRICT_PURCHASES,
};

// ---------------------------------------------------------------------------
// Preset: Custom marker
// ---------------------------------------------------------------------------

export const PRESET_CUSTOM: PresetDefinition & { purchases: Partial<PurchasesConfig> } = {
  code: 'CUSTOM',
  name: 'Personalizado',
  description:
    'Configuracion manual completa. Cada valor es definido explicitamente por el administrador.',
  nameI18nKey: 'config.presets.custom_name',
  descriptionI18nKey: 'config.presets.custom_desc',
  strictness: {},
  fiscal: {},
  workflow: {},
  purchases: {},
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

/**
 * Resolve purchases config defaults for a preset code.
 * Returns undefined when no preset matches (or CUSTOM).
 */
export function getPresetPurchases(code: string): Partial<PurchasesConfig> | undefined {
  const entry = PRESET_MAP[code] as (PresetDefinition & { purchases?: Partial<PurchasesConfig> }) | undefined;
  return entry?.purchases;
}
