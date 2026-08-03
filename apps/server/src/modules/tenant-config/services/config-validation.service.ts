// ---------------------------------------------------------------------------
// Pure validation service for TenantConfig.
// Checks structural constraints on every save. Does NOT throw — the caller
// decides how to handle validation errors.
// ---------------------------------------------------------------------------

import { Injectable } from '@nestjs/common';
import type {
  StrictnessConfig,
  FiscalConfig,
  WorkflowConfig,
  PurchasesConfig,
  CustomCompanyField,
  CustomStrictnessToggle,
  DeliveryConfig,
} from '@pharmacy/shared-types';

export interface ValidationError {
  path: string;
  message: string;
  code: string;
}

@Injectable()
export class ConfigValidationService {
  /**
   * Validates a partial or full config update.
   * Returns an empty array when the payload is valid.
   */
  validate(
    config: Partial<{
      strictness: StrictnessConfig;
      fiscal: FiscalConfig;
      workflow: WorkflowConfig;
      purchases: PurchasesConfig;
      customCompanyFields: CustomCompanyField[];
      customStrictnessToggles: CustomStrictnessToggle[];
    }>,
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    if (config.strictness) {
      this.validateStrictness(config.strictness, errors);
    }
    if (config.fiscal) {
      this.validateFiscal(config.fiscal, errors);
    }
    if (config.workflow) {
      this.validateWorkflow(config.workflow, errors);
    }
    if (config.purchases) {
      this.validatePurchases(config.purchases, errors);
    }
    if (config.customCompanyFields) {
      this.validateCustomFields(config.customCompanyFields, errors);
    }
    if (config.customStrictnessToggles) {
      this.validateCustomToggles(config.customStrictnessToggles, errors);
    }

    return errors;
  }

  private validateStrictness(
    s: StrictnessConfig,
    errors: ValidationError[],
  ): void {
    // Cross-validation: ABOVE_AMOUNT requires threshold > 0
    if (
      s.clientRequired === 'ABOVE_AMOUNT' &&
      (!s.clientRequiredThreshold || s.clientRequiredThreshold <= 0)
    ) {
      errors.push({
        path: 'strictness.clientRequiredThreshold',
        message:
          'clientRequiredThreshold must be greater than 0 when clientRequired is ABOVE_AMOUNT',
        code: 'THRESHOLD_REQUIRED',
      });
    }
  }

  private validateFiscal(
    f: FiscalConfig,
    errors: ValidationError[],
  ): void {
    // Required fields must be non-empty
    const requiredStrings: Array<{ key: keyof FiscalConfig; path: string }> = [
      { key: 'companyName', path: 'fiscal.companyName' },
      { key: 'nit', path: 'fiscal.nit' },
      { key: 'address', path: 'fiscal.address' },
      { key: 'city', path: 'fiscal.city' },
      { key: 'phone', path: 'fiscal.phone' },
      { key: 'email', path: 'fiscal.email' },
      { key: 'dianResolutionNumber', path: 'fiscal.dianResolutionNumber' },
      { key: 'dianResolutionDate', path: 'fiscal.dianResolutionDate' },
      { key: 'dianResolutionPrefix', path: 'fiscal.dianResolutionPrefix' },
    ];

    for (const { key, path } of requiredStrings) {
      const value = f[key];
      if (typeof value !== 'string' || value.trim().length === 0) {
        errors.push({
          path,
          message: `${key} is required and must not be empty`,
          code: 'REQUIRED_FIELD_EMPTY',
        });
      }
    }

    // NIT format: digits only, 9-10 chars + optional check digit (digits only)
    if (f.nit && f.nit.trim().length > 0) {
      const nitClean = f.nit.replace(/-/g, '');
      if (!/^\d{9,10}$/.test(nitClean)) {
        errors.push({
          path: 'fiscal.nit',
          message:
            'NIT must contain 9-10 digits (hyphens allowed, e.g. 123456789-5)',
          code: 'INVALID_NIT_FORMAT',
        });
      }
    }

    // Email format
    if (f.email && f.email.trim().length > 0) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(f.email)) {
        errors.push({
          path: 'fiscal.email',
          message: 'Email format is invalid',
          code: 'INVALID_EMAIL_FORMAT',
        });
      }
    }

    // Tax rate range is enforced by the Zod schema, but double-check at 0 max
    if (f.defaultTaxRate < 0 || f.defaultTaxRate > 100) {
      errors.push({
        path: 'fiscal.defaultTaxRate',
        message: 'Default tax rate must be between 0 and 100',
        code: 'TAX_RATE_OUT_OF_RANGE',
      });
    }

    // Additional taxes: each entry must have name + rate + type
    if (f.additionalTaxes && f.additionalTaxes.length > 0) {
      f.additionalTaxes.forEach((tax, idx) => {
        if (!tax.name || tax.name.trim().length === 0) {
          errors.push({
            path: `fiscal.additionalTaxes[${idx}].name`,
            message: 'Additional tax name is required',
            code: 'TAX_NAME_REQUIRED',
          });
        }
        if (tax.rate == null || tax.rate < 0 || tax.rate > 100) {
          errors.push({
            path: `fiscal.additionalTaxes[${idx}].rate`,
            message: 'Additional tax rate must be between 0 and 100',
            code: 'TAX_RATE_OUT_OF_RANGE',
          });
        }
        if (!tax.type) {
          errors.push({
            path: `fiscal.additionalTaxes[${idx}].type`,
            message: 'Additional tax type is required',
            code: 'TAX_TYPE_REQUIRED',
          });
        }
      });
    }
  }

  private validateWorkflow(
    w: WorkflowConfig,
    errors: ValidationError[],
  ): void {
    // Workflow validation is mostly structural (Zod handles it).
    if (w.delivery) {
      this.validateDelivery(w.delivery, errors);
    }
  }

  /**
   * Delivery (domicilio) policy checks — mirrors the POS local rules
   * (apps/pos-desktop/src/domain/config/validation.ts -> validateDelivery):
   * valid fee mode, non-negative cents, FIXED requires a positive fixed fee,
   * and a manual cap cannot sit below the fixed reference fee.
   */
  private validateDelivery(
    d: DeliveryConfig,
    errors: ValidationError[],
  ): void {
    const validFeeModes: readonly string[] = ['DISABLED', 'FIXED', 'MANUAL'];
    if (!validFeeModes.includes(d.deliveryFeeMode)) {
      errors.push({
        path: 'workflow.delivery.deliveryFeeMode',
        message: `Invalid delivery fee mode: ${d.deliveryFeeMode}`,
        code: 'INVALID_VALUE',
      });
    }

    if (d.fixedDeliveryFeeCents < 0) {
      errors.push({
        path: 'workflow.delivery.fixedDeliveryFeeCents',
        message: 'Fixed delivery fee cannot be negative',
        code: 'INVALID_VALUE',
      });
    }

    if (d.deliveryFeeMode === 'FIXED' && d.fixedDeliveryFeeCents <= 0) {
      errors.push({
        path: 'workflow.delivery.fixedDeliveryFeeCents',
        message: 'A fixed delivery fee greater than zero is required when the mode is FIXED',
        code: 'CROSS_FIELD_MISSING',
      });
    }

    if (d.maxDeliveryFeeCents < 0) {
      errors.push({
        path: 'workflow.delivery.maxDeliveryFeeCents',
        message: 'Maximum delivery fee cannot be negative',
        code: 'INVALID_VALUE',
      });
    }

    if (
      d.deliveryFeeMode === 'MANUAL' &&
      d.maxDeliveryFeeCents > 0 &&
      d.maxDeliveryFeeCents < d.fixedDeliveryFeeCents
    ) {
      errors.push({
        path: 'workflow.delivery.maxDeliveryFeeCents',
        message: 'Maximum delivery fee cannot be lower than the fixed reference fee',
        code: 'INVALID_VALUE',
      });
    }
  }

  private validatePurchases(
    p: PurchasesConfig,
    errors: ValidationError[],
  ): void {
    // autoConfirmOnCreate + requireManagerPinForConfirm conflict check
    if (p.autoConfirmOnCreate && p.requireManagerPinForConfirm) {
      errors.push({
        path: 'purchases.autoConfirmOnCreate',
        message:
          'autoConfirmOnCreate cannot be enabled when requireManagerPinForConfirm is also enabled — ' +
          'auto-confirm bypasses the manager PIN requirement',
        code: 'PURCHASES_AUTO_CONFIRM_CONFLICT',
      });
    }
  }

  private validateCustomFields(
    fields: CustomCompanyField[],
    errors: ValidationError[],
  ): void {
    // Keys must be unique within the array
    const keys = new Set<string>();
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (!field.key || field.key.trim().length === 0) {
        errors.push({
          path: `customCompanyFields[${i}].key`,
          message: 'Custom field key is required',
          code: 'FIELD_KEY_REQUIRED',
        });
        continue;
      }
      if (keys.has(field.key)) {
        errors.push({
          path: `customCompanyFields[${i}].key`,
          message: `Duplicate custom field key: "${field.key}"`,
          code: 'DUPLICATE_FIELD_KEY',
        });
      }
      keys.add(field.key);
    }
  }

  private validateCustomToggles(
    toggles: CustomStrictnessToggle[],
    errors: ValidationError[],
  ): void {
    // Known strictness toggle keys that cannot be overridden
    const knownToggleKeys = new Set([
      'lots',
      'expiryDates',
      'stockValidation',
      'clientRequired',
      'prescriptionEnforcement',
      'inventoryAdjustmentReason',
      'returnsRequireOriginalSale',
      'cashShiftRequired',
      'receiptPrintRequired',
      'autoOpenDrawer',
      'customerDisplayRequired',
      'prescriptionExpiryDays',
    ]);

    const keys = new Set<string>();
    for (let i = 0; i < toggles.length; i++) {
      const toggle = toggles[i];
      if (!toggle.key || toggle.key.trim().length === 0) {
        errors.push({
          path: `customStrictnessToggles[${i}].key`,
          message: 'Custom toggle key is required',
          code: 'TOGGLE_KEY_REQUIRED',
        });
        continue;
      }

      if (knownToggleKeys.has(toggle.key)) {
        errors.push({
          path: `customStrictnessToggles[${i}].key`,
          message: `Toggle key "${toggle.key}" conflicts with a built-in strictness field`,
          code: 'TOGGLE_KEY_CONFLICT',
        });
      }

      if (keys.has(toggle.key)) {
        errors.push({
          path: `customStrictnessToggles[${i}].key`,
          message: `Duplicate custom toggle key: "${toggle.key}"`,
          code: 'DUPLICATE_TOGGLE_KEY',
        });
      }
      keys.add(toggle.key);
    }
  }
}
