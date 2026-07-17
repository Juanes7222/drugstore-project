/**
 * Pure validation functions for tenant configuration.
 *
 * Mirrors the server's config-validation.service.ts rules so that
 * the POS can validate locally before sending to the server.
 * Returns arrays of `ConfigValidationError` — never throws.
 */

import type {
  TenantConfig,
  StrictnessConfig,
  FiscalConfig,
  WorkflowConfig,
  CustomCompanyField,
  CustomStrictnessToggle,
} from './types';
import type { ConfigValidationError } from './types';
import { getPreset } from './presets';

// ---------------------------------------------------------------------------
// Known strictness keys (to prevent collision with custom toggles)
// ---------------------------------------------------------------------------

const KNOWN_STRICTNESS_KEYS: readonly string[] = [
  'lots',
  'expiryDates',
  'stockValidation',
  'clientRequired',
  'clientRequiredThreshold',
  'prescriptionEnforcement',
  'inventoryAdjustmentReason',
  'returnsRequireOriginalSale',
  'cashShiftRequired',
  'receiptPrintRequired',
  'autoOpenDrawer',
  'customerDisplayRequired',
  'prescriptionExpiryDays',
];

// ---------------------------------------------------------------------------
// Main validation entry point
// ---------------------------------------------------------------------------

export function validateTenantConfig(config: Partial<TenantConfig>): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  errors.push(...validateStrictness(config.strictness));
  errors.push(...validateFiscal(config.fiscal));
  errors.push(...validateWorkflow(config.workflow));

  if (config.customCompanyFields) {
    errors.push(...validateCustomFields(config.customCompanyFields));
  }

  if (config.customStrictnessToggles) {
    errors.push(...validateCustomToggles(config.customStrictnessToggles));
  }

  // Cross-field validation
  if (config.strictness) {
    errors.push(...crossValidateStrictness(config.strictness));
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Strictness validation
// ---------------------------------------------------------------------------

function validateStrictness(s?: Partial<StrictnessConfig>): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  if (!s) return [];

  const validLevels = ['STRICT', 'OPTIONAL', 'OFF'];
  const validClientReq = ['ALWAYS', 'ABOVE_AMOUNT', 'NEVER'];
  const validStock = ['STRICT', 'WARN', 'OFF'];
  const validPrescription = ['STRICT', 'WARN', 'OFF'];
  const validReceipt = ['STRICT', 'OPTIONAL', 'OFF'];
  const validDrawer = ['ALWAYS', 'CASH_ONLY', 'MANUAL'];
  const validReturnsReq = ['STRICT', 'WITH_MANAGER_AUTH', 'OFF'];

  if (s.lots && !validLevels.includes(s.lots)) {
    errors.push({ path: 'strictness.lots', message: `Valor invalido: ${s.lots}`, code: 'INVALID_VALUE' });
  }
  if (s.expiryDates && !validLevels.includes(s.expiryDates)) {
    errors.push({ path: 'strictness.expiryDates', message: `Valor invalido: ${s.expiryDates}`, code: 'INVALID_VALUE' });
  }
  if (s.stockValidation && !validStock.includes(s.stockValidation)) {
    errors.push({ path: 'strictness.stockValidation', message: `Valor invalido: ${s.stockValidation}`, code: 'INVALID_VALUE' });
  }
  if (s.clientRequired && !validClientReq.includes(s.clientRequired)) {
    errors.push({ path: 'strictness.clientRequired', message: `Valor invalido: ${s.clientRequired}`, code: 'INVALID_VALUE' });
  }
  if (s.prescriptionEnforcement && !validPrescription.includes(s.prescriptionEnforcement)) {
    errors.push({ path: 'strictness.prescriptionEnforcement', message: `Valor invalido: ${s.prescriptionEnforcement}`, code: 'INVALID_VALUE' });
  }
  if (s.receiptPrintRequired && !validReceipt.includes(s.receiptPrintRequired)) {
    errors.push({ path: 'strictness.receiptPrintRequired', message: `Valor invalido: ${s.receiptPrintRequired}`, code: 'INVALID_VALUE' });
  }
  if (s.autoOpenDrawer && !validDrawer.includes(s.autoOpenDrawer)) {
    errors.push({ path: 'strictness.autoOpenDrawer', message: `Valor invalido: ${s.autoOpenDrawer}`, code: 'INVALID_VALUE' });
  }
  if (s.returnsRequireOriginalSale && !validReturnsReq.includes(s.returnsRequireOriginalSale)) {
    errors.push({ path: 'strictness.returnsRequireOriginalSale', message: `Valor invalido: ${s.returnsRequireOriginalSale}`, code: 'INVALID_VALUE' });
  }

  return errors;
}

function crossValidateStrictness(s: Partial<StrictnessConfig>): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];

  if (s.clientRequired === 'ABOVE_AMOUNT') {
    const threshold = s.clientRequiredThreshold;
    if (threshold === undefined || threshold === null || threshold <= 0) {
      errors.push({
        path: 'strictness.clientRequiredThreshold',
        message: 'Debe especificar un monto minimo cuando cliente es requerido sobre cierto valor',
        code: 'CROSS_FIELD_MISSING',
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Fiscal validation
// ---------------------------------------------------------------------------

function validateFiscal(f?: Partial<FiscalConfig>): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  if (!f) return [];

  if (f.companyName !== undefined && f.companyName.trim().length === 0) {
    errors.push({ path: 'fiscal.companyName', message: 'Nombre de la empresa es requerido', code: 'REQUIRED' });
  }

  if (f.nit !== undefined && !isValidNit(f.nit)) {
    errors.push({
      path: 'fiscal.nit',
      message: 'NIT invalido. Debe tener 9 o 10 digitos numericos (con digito de verificacion)',
      code: 'INVALID_FORMAT',
    });
  }

  if (f.email !== undefined && f.email.length > 0 && !isValidEmail(f.email)) {
    errors.push({ path: 'fiscal.email', message: 'Email invalido', code: 'INVALID_FORMAT' });
  }

  if (f.defaultTaxRate !== undefined) {
    if (typeof f.defaultTaxRate !== 'number' || f.defaultTaxRate < 0 || f.defaultTaxRate > 1) {
      errors.push({
        path: 'fiscal.defaultTaxRate',
        message: 'La tasa de IVA debe estar entre 0 y 1 (ej: 0.19 para 19%)',
        code: 'INVALID_VALUE',
      });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Workflow validation
// ---------------------------------------------------------------------------

function validateWorkflow(w?: Partial<WorkflowConfig>): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  if (!w) return [];

  if (w.maxOfflineLoginDays !== undefined && (w.maxOfflineLoginDays < 1 || w.maxOfflineLoginDays > 365)) {
    errors.push({
      path: 'workflow.maxOfflineLoginDays',
      message: 'Los dias de login offline deben estar entre 1 y 365',
      code: 'OUT_OF_RANGE',
    });
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Custom fields validation
// ---------------------------------------------------------------------------

function validateCustomFields(fields: CustomCompanyField[]): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  const keys = new Set<string>();

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];

    if (!field.key || field.key.trim().length === 0) {
      errors.push({ path: `customCompanyFields[${i}].key`, message: 'Key es requerida', code: 'REQUIRED' });
      continue;
    }

    if (keys.has(field.key)) {
      errors.push({
        path: `customCompanyFields[${i}].key`,
        message: `Key duplicada: ${field.key}`,
        code: 'DUPLICATE_KEY',
      });
    }
    keys.add(field.key);

    if (!field.name || field.name.trim().length === 0) {
      errors.push({ path: `customCompanyFields[${i}].name`, message: 'Nombre es requerido', code: 'REQUIRED' });
    }

    const validTypes = ['TEXT', 'NUMBER', 'DATE', 'URL', 'EMAIL'];
    if (!validTypes.includes(field.type)) {
      errors.push({ path: `customCompanyFields[${i}].type`, message: `Tipo invalido: ${field.type}`, code: 'INVALID_VALUE' });
    }

    if (field.order < 0) {
      errors.push({ path: `customCompanyFields[${i}].order`, message: 'Orden debe ser >= 0', code: 'INVALID_VALUE' });
    }
  }

  return errors;
}

function validateCustomToggles(toggles: CustomStrictnessToggle[]): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  const keys = new Set<string>();

  for (let i = 0; i < toggles.length; i++) {
    const toggle = toggles[i];

    if (!toggle.key || toggle.key.trim().length === 0) {
      errors.push({ path: `customStrictnessToggles[${i}].key`, message: 'Key es requerida', code: 'REQUIRED' });
      continue;
    }

    if (KNOWN_STRICTNESS_KEYS.includes(toggle.key)) {
      errors.push({
        path: `customStrictnessToggles[${i}].key`,
        message: `La key "${toggle.key}" ya existe como toggle conocido`,
        code: 'KEY_COLLISION',
      });
    }

    if (keys.has(toggle.key)) {
      errors.push({
        path: `customStrictnessToggles[${i}].key`,
        message: `Key duplicada: ${toggle.key}`,
        code: 'DUPLICATE_KEY',
      });
    }
    keys.add(toggle.key);

    const validTypes = ['BOOLEAN', 'SELECT', 'AMOUNT'];
    if (!validTypes.includes(toggle.type)) {
      errors.push({ path: `customStrictnessToggles[${i}].type`, message: `Tipo invalido: ${toggle.type}`, code: 'INVALID_VALUE' });
    }

    const validAppliesTo = ['SALE', 'RETURN', 'INVENTORY', 'CLIENT', 'ALL'];
    if (!validAppliesTo.includes(toggle.appliesTo)) {
      errors.push({ path: `customStrictnessToggles[${i}].appliesTo`, message: `Aplica a invalido: ${toggle.appliesTo}`, code: 'INVALID_VALUE' });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

const NIT_REGEX = /^\d{9,10}$/;

function isValidNit(nit: string): boolean {
  return NIT_REGEX.test(nit.replace(/[-\s]/g, ''));
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(email: string): boolean {
  return EMAIL_REGEX.test(email);
}

// ---------------------------------------------------------------------------
// Preset-specific validation
// ---------------------------------------------------------------------------

/**
 * Validate that a preset code is known and supported.
 */
export function validatePresetCode(code: string): ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  const preset = getPreset(code);
  if (!preset) {
    errors.push({
      path: 'activePresetCode',
      message: `Preset desconocido: "${code}". Valores: SIMPLE, BALANCED, STRICT, CUSTOM`,
      code: 'UNKNOWN_PRESET',
    });
  }
  return errors;
}
