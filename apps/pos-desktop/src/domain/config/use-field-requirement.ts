/**
 * React hook that resolves field requirement based on the current effective config.
 *
 * The canonical hook for forms to decide whether a field is REQUIRED, OPTIONAL, or HIDDEN.
 * Also handles custom toggles (advisory mode).
 */

import { useMemo } from 'react';
import { useSyncExternalStore, useCallback } from 'react';
import { useTenantConfigStore } from './tenant-config.store';
import type { FieldRequirement, EffectiveConfig, CustomStrictnessToggle } from './types';
import {
  getLotRequirement,
  getExpiryDateRequirement,
  getClientRequirement,
  getPrescriptionEnforcementBehavior,
  getAdjustmentReasonRequirement,
  getReceiptPrintRequirement,
  isCustomerDisplayRequired,
} from './field-requirements';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type KnownFieldKey =
  | 'lots'
  | 'expiryDates'
  | 'stockValidation'
  | 'clientRequired'
  | 'prescriptionEnforcement'
  | 'inventoryAdjustmentReason'
  | 'returnsRequireOriginalSale'
  | 'cashShiftRequired'
  | 'receiptPrintRequired'
  | 'autoOpenDrawer'
  | 'customerDisplayRequired'
  | 'prescriptionExpiryDays';

export interface UseFieldRequirementResult {
  /** Requirement level for the requested field. */
  requirement: FieldRequirement;

  /** For clientRequired with ABOVE_AMOUNT, the threshold in COP cents. */
  clientRequiredThreshold: number;

  /** Current effective config (for additional checks). */
  effectiveConfig: EffectiveConfig | null;

  /** All custom strictness toggles. */
  customToggles: CustomStrictnessToggle[];

  /** Resolve requirement for a specific custom toggle by key. */
  getCustomToggleRequirement: (toggleKey: string) => {
    toggle: CustomStrictnessToggle | undefined;
    isAdvisory: boolean;
  };
}

/**
 * Hook that provides field requirement info based on the current tenant config.
 *
 * @param saleTotalCents - Optional sale total in cents, used for ABOVE_AMOUNT client requirement.
 */
export function useFieldRequirement(_saleTotalCents?: number): UseFieldRequirementResult {
  const store = useTenantConfigStore;

  const state = useSyncExternalStore(
    useCallback((onStoreChange: () => void) => {
      const unsub = store.subscribe(onStoreChange);
      return unsub;
    }, [store]),
    useCallback(() => store.getState(), [store]),
  );

  const effectiveConfig = state.effectiveConfig;

  return useMemo(() => {
    if (!effectiveConfig) {
      return {
        requirement: 'OPTIONAL' as FieldRequirement,
        clientRequiredThreshold: 0,
        effectiveConfig: null,
        customToggles: [],
        getCustomToggleRequirement: () => ({ toggle: undefined, isAdvisory: false }),
      };
    }

    const strictness = effectiveConfig.strictness;
    const customToggles = effectiveConfig.customStrictnessToggles;

    return {
      requirement: 'OPTIONAL' as FieldRequirement,
      clientRequiredThreshold: strictness.clientRequiredThreshold,
      effectiveConfig,
      customToggles,

      getCustomToggleRequirement: (toggleKey: string) => {
        const toggle = customToggles.find((t) => t.key === toggleKey);
        return {
          toggle,
          isAdvisory: toggle?.isAdvisory ?? false,
        };
      },
    };
  }, [effectiveConfig]);
}

/**
 * Convenience hook to check a single field.
 */
export function useFieldRequirementFor(
  field: KnownFieldKey,
): FieldRequirement {
  const store = useTenantConfigStore;

  const state = useSyncExternalStore(
    useCallback((onStoreChange: () => void) => {
      const unsub = store.subscribe(onStoreChange);
      return unsub;
    }, [store]),
    useCallback(() => store.getState(), [store]),
  );

  return useMemo(() => {
    if (!state.effectiveConfig) return 'OPTIONAL';

    const strictness = state.effectiveConfig.strictness;

    switch (field) {
      case 'lots':
        return getLotRequirement(strictness);
      case 'expiryDates':
        return getExpiryDateRequirement(strictness);
      case 'clientRequired':
        return getClientRequirement(strictness, 0);
      case 'prescriptionEnforcement':
        return getPrescriptionEnforcementBehavior(strictness) === 'BLOCK'
          ? 'REQUIRED'
          : getPrescriptionEnforcementBehavior(strictness) === 'WARN'
            ? 'OPTIONAL'
            : 'HIDDEN';
      case 'inventoryAdjustmentReason':
        return getAdjustmentReasonRequirement(strictness);
      case 'receiptPrintRequired':
        return getReceiptPrintRequirement(strictness);
      case 'customerDisplayRequired':
        return isCustomerDisplayRequired(strictness) ? 'REQUIRED' : 'HIDDEN';
      default:
        return 'OPTIONAL';
    }
  }, [state.effectiveConfig, field]);
}
