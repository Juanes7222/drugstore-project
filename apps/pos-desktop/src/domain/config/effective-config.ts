/**
 * Compute the effective configuration from a TenantConfig.
 *
 * The effective config is what the POS actually uses at runtime:
 * - If `activePresetCode === 'CUSTOM'`, the config is already effective.
 * - Otherwise, start with the preset's values, then merge any overrides.
 * - Custom strictness toggles are always appended.
 */

import type { TenantConfig, EffectiveConfig, OverrideMap, WorkstationConfig } from './types';
import { getPreset } from './presets';
import {
  DEFAULT_STRICTNESS,
  DEFAULT_FISCAL,
  DEFAULT_WORKFLOW,
  EMPTY_CUSTOM_FIELDS,
  EMPTY_CUSTOM_TOGGLES,
} from './defaults';

// ---------------------------------------------------------------------------
// Effective config computation
// ---------------------------------------------------------------------------

/**
 * Compute the effective config from a tenant config and optional workstation
 * overrides.
 *
 * The effective config merges:
 * 1. The active preset's values (if any)
 * 2. The actual stored values (which override the preset's)
 * 3. Per-workstation overrides (highest precedence — only non-system fields)
 * 4. Custom fields and toggles (always additive)
 */
export function computeEffectiveConfig(
  config: TenantConfig,
  workstationConfig?: WorkstationConfig,
): EffectiveConfig {
  const isCustom = config.activePresetCode === 'CUSTOM';
  const preset = config.activePresetCode && !isCustom
    ? getPreset(config.activePresetCode)
    : undefined;

  // Base strictness: start with preset or defaults
  const baseStrictness = preset
    ? { ...DEFAULT_STRICTNESS, ...preset.strictness }
    : { ...DEFAULT_STRICTNESS };

  // Base workflow: start with preset or defaults
  const baseWorkflow = preset
    ? { ...DEFAULT_WORKFLOW, ...preset.workflow }
    : { ...DEFAULT_WORKFLOW };

  // Base fiscal: start with defaults, then overlay whatever is stored
  const baseFiscal = { ...DEFAULT_FISCAL };

  // Merge stored values on top of base
  const mergedStrictness = { ...baseStrictness, ...config.strictness };
  const mergedFiscal = { ...baseFiscal, ...config.fiscal };
  const mergedWorkflow = { ...baseWorkflow, ...config.workflow };

  // Merge per-workstation overrides on top (highest precedence)
  // Server already strips system-level fields, so only non-system
  // operational preferences reach this point.
  if (workstationConfig) {
    if (workstationConfig.strictness) {
      Object.assign(mergedStrictness, workstationConfig.strictness);
    }
    if (workstationConfig.workflow) {
      Object.assign(mergedWorkflow, workstationConfig.workflow);
    }
  }

  return {
    strictness: mergedStrictness,
    fiscal: mergedFiscal,
    workflow: mergedWorkflow,
    customCompanyFields: config.customCompanyFields ?? EMPTY_CUSTOM_FIELDS,
    customStrictnessToggles: config.customStrictnessToggles ?? EMPTY_CUSTOM_TOGGLES,
    activePresetCode: config.activePresetCode,
    configVersion: config.configVersion,
  };
}

// ---------------------------------------------------------------------------
// Override detection
// ---------------------------------------------------------------------------

/**
 * Returns a map of field paths that differ from the active preset.
 * Used by the UI to show "Customizado" badges.
 */
export function getOverriddenFields(config: TenantConfig): OverrideMap {
  const overrides: OverrideMap = {};
  const isCustom = config.activePresetCode === 'CUSTOM';

  if (isCustom || !config.activePresetCode) {
    return {};
  }

  const preset = getPreset(config.activePresetCode);
  if (!preset) {
    return {};
  }

  // Check strictness fields that are defined in the preset
  for (const [key, presetValue] of Object.entries(preset.strictness)) {
    const storedValue = (config.strictness as unknown as Record<string, unknown>)[key];
    if (storedValue !== undefined && storedValue !== presetValue) {
      overrides[`strictness.${key}`] = true;
    }
  }

  // Check workflow fields that are defined in the preset
  for (const [key, presetValue] of Object.entries(preset.workflow)) {
    const storedValue = (config.workflow as unknown as Record<string, unknown>)[key];
    if (storedValue !== undefined && storedValue !== presetValue) {
      overrides[`workflow.${key}`] = true;
    }
  }

  return overrides;
}

/**
 * Check if the config has any overrides from the active preset.
 */
export function hasOverrides(config: TenantConfig): boolean {
  return Object.keys(getOverriddenFields(config)).length > 0;
}

/**
 * Check if a specific field has been overridden from the preset value.
 */
export function isFieldOverridden(config: TenantConfig, fieldPath: string): boolean {
  return getOverriddenFields(config)[fieldPath] === true;
}
