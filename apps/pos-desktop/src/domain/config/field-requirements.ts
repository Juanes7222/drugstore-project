/**
 * Canonical requirement check functions.
 *
 * Every service that needs to know "is this field required / optional / hidden
 * based on the current strictness config?" calls these functions.
 *
 * Centralizing this logic here instead of scattering `if (config.lots === 'STRICT')`
 * throughout the codebase.
 */

import type { StrictnessConfig, FieldRequirement } from './types';
import type { EffectiveConfig } from './types';

// ---------------------------------------------------------------------------
// Strictness-level helpers
// ---------------------------------------------------------------------------

function strictnessToRequirement(level: 'STRICT' | 'OPTIONAL' | 'OFF'): FieldRequirement {
  switch (level) {
    case 'STRICT':
      return 'REQUIRED';
    case 'OPTIONAL':
      return 'OPTIONAL';
    case 'OFF':
      return 'HIDDEN';
    default: {
      const _exhaustive: never = level;
      throw new Error(`Unhandled strictness level: ${_exhaustive}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Field-specific requirement functions
// ---------------------------------------------------------------------------

/**
 * Should lot/batch fields be required, optional, or hidden?
 */
export function getLotRequirement(
  strictness: StrictnessConfig | EffectiveConfig,
): FieldRequirement {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  return strictnessToRequirement(s.lots);
}

/**
 * Should expiry date fields be required, optional, or hidden?
 */
export function getExpiryDateRequirement(
  strictness: StrictnessConfig | EffectiveConfig,
): FieldRequirement {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  return strictnessToRequirement(s.expiryDates);
}

/**
 * Should stock validation block sales with insufficient stock?
 */
export function getStockValidationBehavior(
  strictness: StrictnessConfig | EffectiveConfig,
): 'BLOCK' | 'WARN' | 'SKIP' {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  switch (s.stockValidation) {
    case 'STRICT':
      return 'BLOCK';
    case 'WARN':
      return 'WARN';
    case 'OFF':
      return 'SKIP';
    default: {
      const _exhaustive: never = s.stockValidation;
      throw new Error(`Unhandled stock validation: ${_exhaustive}`);
    }
  }
}

/**
 * Is a client required for sales?
 */
export function getClientRequirement(
  strictness: StrictnessConfig | EffectiveConfig,
  saleTotalCents: number,
): FieldRequirement {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;

  switch (s.clientRequired) {
    case 'ALWAYS':
      return 'REQUIRED';
    case 'NEVER':
      return 'HIDDEN';
    case 'ABOVE_AMOUNT':
      return saleTotalCents >= s.clientRequiredThreshold ? 'REQUIRED' : 'OPTIONAL';
    default: {
      const _exhaustive: never = s.clientRequired;
      throw new Error(`Unhandled client requirement: ${_exhaustive}`);
    }
  }
}

/**
 * Should prescription enforcement block sales or just warn?
 */
export function getPrescriptionEnforcementBehavior(
  strictness: StrictnessConfig | EffectiveConfig,
): 'BLOCK' | 'WARN' | 'SKIP' {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  switch (s.prescriptionEnforcement) {
    case 'STRICT':
      return 'BLOCK';
    case 'WARN':
      return 'WARN';
    case 'OFF':
      return 'SKIP';
    default: {
      const _exhaustive: never = s.prescriptionEnforcement;
      throw new Error(`Unhandled prescription enforcement: ${_exhaustive}`);
    }
  }
}

/**
 * Is an inventory adjustment reason required?
 */
export function getAdjustmentReasonRequirement(
  strictness: StrictnessConfig | EffectiveConfig,
): FieldRequirement {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  return strictnessToRequirement(s.inventoryAdjustmentReason);
}

/**
 * Should returns require the original sale?
 */
export function getReturnsOriginalSaleRequirement(
  strictness: StrictnessConfig | EffectiveConfig,
): 'REQUIRED' | 'MANAGER_AUTH' | 'OFF' {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  switch (s.returnsRequireOriginalSale) {
    case 'STRICT':
      return 'REQUIRED';
    case 'WITH_MANAGER_AUTH':
      return 'MANAGER_AUTH';
    case 'OFF':
      return 'OFF';
    default: {
      const _exhaustive: never = s.returnsRequireOriginalSale;
      throw new Error(`Unhandled returns requirement: ${_exhaustive}`);
    }
  }
}

/**
 * Is a cash shift required before making sales?
 */
export function isCashShiftRequired(
  strictness: StrictnessConfig | EffectiveConfig,
): boolean {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  return s.cashShiftRequired;
}

/**
 * Should receipt printing be required, optional, or hidden?
 */
export function getReceiptPrintRequirement(
  strictness: StrictnessConfig | EffectiveConfig,
): FieldRequirement {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  return strictnessToRequirement(s.receiptPrintRequired);
}

/**
 * When should the cash drawer auto-open?
 */
export function getAutoOpenDrawerBehavior(
  strictness: StrictnessConfig | EffectiveConfig,
): 'ALWAYS' | 'CASH_ONLY' | 'MANUAL' {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  return s.autoOpenDrawer;
}

/**
 * Is the customer display required?
 */
export function isCustomerDisplayRequired(
  strictness: StrictnessConfig | EffectiveConfig,
): boolean {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  return s.customerDisplayRequired;
}

/**
 * How many days is a prescription valid?
 */
export function getPrescriptionExpiryDays(
  strictness: StrictnessConfig | EffectiveConfig,
): number {
  const s = 'strictness' in strictness ? strictness.strictness : strictness;
  return s.prescriptionExpiryDays;
}
