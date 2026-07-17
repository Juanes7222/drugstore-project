/**
 * Tests for effective config computation and override detection.
 */
import { describe, expect, it } from "vitest";
import {
  computeEffectiveConfig,
  getOverriddenFields,
  hasOverrides,
  isFieldOverridden,
} from "./effective-config";
import type { TenantConfig, PresetCode, StrictnessConfig, FiscalConfig, WorkflowConfig, CustomCompanyField, CustomStrictnessToggle, WorkstationConfig } from "./types";
import { PRESET_BALANCED } from "./presets";
import {
  DEFAULT_STRICTNESS,
  DEFAULT_FISCAL,
  DEFAULT_WORKFLOW,
} from "./defaults";

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeTenantConfig(
  overrides?: Record<string, unknown>,
): TenantConfig {
  const ov = overrides ?? {};
  return {
    id: "test-config-id",
    subscriptionId: "sub-1",
    activePresetCode: (ov.activePresetCode as PresetCode) ?? ("BALANCED" as PresetCode),
    strictness: { ...DEFAULT_STRICTNESS, ...(ov.strictness as Partial<StrictnessConfig>) } as StrictnessConfig,
    fiscal: { ...DEFAULT_FISCAL, ...(ov.fiscal as Partial<FiscalConfig>) } as FiscalConfig,
    workflow: { ...DEFAULT_WORKFLOW, ...(ov.workflow as Partial<WorkflowConfig>) } as WorkflowConfig,
    customCompanyFields: (ov.customCompanyFields as CustomCompanyField[]) ?? [],
    customStrictnessToggles: (ov.customStrictnessToggles as CustomStrictnessToggle[]) ?? [],
    configVersion: (ov.configVersion as number) ?? 1,
    lastModifiedByUserId: (ov.lastModifiedByUserId as string) ?? "user-1",
    lastModifiedAt: (ov.lastModifiedAt as string) ?? "2026-07-17T00:00:00Z",
    createdAt: (ov.createdAt as string) ?? "2026-01-01T00:00:00Z",
  };
}

// ---------------------------------------------------------------------------
// Tests — computeEffectiveConfig
// ---------------------------------------------------------------------------

describe("computeEffectiveConfig", () => {
  it("merges preset values into the effective config for a known preset", () => {
    const config = makeTenantConfig();

    const result = computeEffectiveConfig(config);

    expect(result.strictness.lots).toBe("OPTIONAL");
    expect(result.strictness.clientRequiredThreshold).toBe(50000);
    expect(result.workflow.requireShiftOpenForSale).toBe(true);
  });

  it("overrides preset values with stored overrides", () => {
    const config = makeTenantConfig();
    config.strictness = { ...DEFAULT_STRICTNESS, lots: "STRICT" };

    const result = computeEffectiveConfig(config);

    expect(result.strictness.lots).toBe("STRICT");
    // Other preset values remain unchanged
    expect(result.strictness.clientRequired).toBe("ABOVE_AMOUNT");
  });

  it("returns config as-is when preset is CUSTOM", () => {
    const config = makeTenantConfig({
      activePresetCode: "CUSTOM" as PresetCode,
      strictness: { lots: "STRICT", expiryDates: "STRICT" },
    });

    const result = computeEffectiveConfig(config);

    expect(result.strictness.lots).toBe("STRICT");
    expect(result.strictness.expiryDates).toBe("STRICT");
    // Non-overridden fields use defaults
    expect(result.strictness.clientRequired).toBe(
      DEFAULT_STRICTNESS.clientRequired,
    );
  });

  it("applies defaults when activePresetCode is null", () => {
    const config = makeTenantConfig({ activePresetCode: null });

    const result = computeEffectiveConfig(config);

    expect(result.strictness.lots).toBe(DEFAULT_STRICTNESS.lots);
    expect(result.strictness.stockValidation).toBe(
      DEFAULT_STRICTNESS.stockValidation,
    );
    expect(result.workflow.maxOfflineLoginDays).toBe(
      DEFAULT_WORKFLOW.maxOfflineLoginDays,
    );
  });

  it("returns empty defaults for unknown preset code", () => {
    const config = makeTenantConfig({
      activePresetCode: "UNKNOWN" as PresetCode,
    });

    const result = computeEffectiveConfig(config);

    // Falls back to global defaults
    expect(result.strictness.lots).toBe(DEFAULT_STRICTNESS.lots);
    expect(result.strictness.clientRequired).toBe(
      DEFAULT_STRICTNESS.clientRequired,
    );
  });

  it("preserves customCompanyFields in the effective config", () => {
    const fields: CustomCompanyField[] = [
      { id: "field-1", key: "licencia", name: "Licencia", type: "TEXT", value: "", required: false, showOnInvoice: false, showOnReport: false, order: 1 },
    ];
    const config = makeTenantConfig({ customCompanyFields: fields });

    const result = computeEffectiveConfig(config);

    expect(result.customCompanyFields).toEqual(fields);
  });

  it("preserves customStrictnessToggles in the effective config", () => {
    const toggles: CustomStrictnessToggle[] = [
      { id: "toggle-1", key: "requireDoctorId", name: "Requiere ID del doctor", description: "", type: "BOOLEAN", appliesTo: "SALE", defaultValue: false, isAdvisory: false },
    ];
    const config = makeTenantConfig({ customStrictnessToggles: toggles });

    const result = computeEffectiveConfig(config);

    expect(result.customStrictnessToggles).toEqual(toggles);
  });

  it("uses empty arrays for missing custom fields", () => {
    const config = makeTenantConfig();
    // @ts-expect-error — force undefined to test fallback
    delete config.customCompanyFields;
    // @ts-expect-error — force undefined to test fallback
    delete config.customStrictnessToggles;

    const result = computeEffectiveConfig(config);

    expect(result.customCompanyFields).toEqual([]);
    expect(result.customStrictnessToggles).toEqual([]);
  });

  it("carries configVersion through to effective config", () => {
    const config = makeTenantConfig({ configVersion: 42 });

    const result = computeEffectiveConfig(config);

    expect(result.configVersion).toBe(42);
  });

  it("carries activePresetCode through to effective config", () => {
    const config = makeTenantConfig({ activePresetCode: "STRICT" as PresetCode });

    const result = computeEffectiveConfig(config);

    expect(result.activePresetCode).toBe("STRICT");
  });

  it("merges workflow values correctly", () => {
    const config = makeTenantConfig({
      workflow: { autoPrintOnConfirm: false },
    });

    const result = computeEffectiveConfig(config);

    expect(result.workflow.autoPrintOnConfirm).toBe(false);
    // Other workflow values come from preset
    expect(result.workflow.requireShiftOpenForSale).toBe(
      PRESET_BALANCED.workflow.requireShiftOpenForSale,
    );
  });

  it("computes effective config where preset matches stored — no drift", () => {
    const config = makeTenantConfig({
      strictness: {},
      workflow: {},
    });

    const result = computeEffectiveConfig(config);

    // All values should match the preset exactly
    expect(result.strictness).toMatchObject(PRESET_BALANCED.strictness);
    expect(result.workflow).toMatchObject(PRESET_BALANCED.workflow);
  });
});

// ---------------------------------------------------------------------------
// Tests — getOverriddenFields
// ---------------------------------------------------------------------------

describe("getOverriddenFields", () => {
  it("returns empty map when config has no overrides", () => {
    const config = makeTenantConfig({ strictness: {}, workflow: {} });

    const result = getOverriddenFields(config);

    expect(result).toEqual({});
  });

  it("detects overridden strictness fields", () => {
    const config = makeTenantConfig({
      strictness: { lots: "OFF" },
    });

    const result = getOverriddenFields(config);

    expect(result["strictness.lots"]).toBe(true);
  });

  it("detects overridden workflow fields", () => {
    const config = makeTenantConfig({
      workflow: { requireShiftOpenForSale: false },
    });

    const result = getOverriddenFields(config);

    expect(result["workflow.requireShiftOpenForSale"]).toBe(true);
  });

  it("detects multiple overridden fields simultaneously", () => {
    const config = makeTenantConfig({
      strictness: { lots: "OFF", expiryDates: "OFF" },
      workflow: { autoPrintOnConfirm: false },
    });

    const result = getOverriddenFields(config);

    expect(result["strictness.lots"]).toBe(true);
    expect(result["strictness.expiryDates"]).toBe(true);
    expect(result["workflow.autoPrintOnConfirm"]).toBe(true);
  });

  it("returns empty map for CUSTOM preset", () => {
    const config = makeTenantConfig({
      activePresetCode: "CUSTOM" as PresetCode,
      strictness: { lots: "STRICT" },
    });

    const result = getOverriddenFields(config);

    expect(result).toEqual({});
  });

  it("returns empty map when activePresetCode is null", () => {
    const config = makeTenantConfig({
      activePresetCode: null,
      strictness: { lots: "STRICT" },
    });

    const result = getOverriddenFields(config);

    expect(result).toEqual({});
  });

  it("returns empty map when preset code is unknown", () => {
    const config = makeTenantConfig({
      activePresetCode: "UNKNOWN" as PresetCode,
    });

    const result = getOverriddenFields(config);

    expect(result).toEqual({});
  });

  it("does not include fields that match the preset value exactly", () => {
    const config = makeTenantConfig({
      strictness: { lots: "OPTIONAL" }, // Same as BALANCED preset
    });

    const result = getOverriddenFields(config);

    expect(result["strictness.lots"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests — hasOverrides
// ---------------------------------------------------------------------------

describe("hasOverrides", () => {
  it("returns false when no overrides exist", () => {
    const config = makeTenantConfig();

    expect(hasOverrides(config)).toBe(false);
  });

  it("returns true when overrides exist", () => {
    const config = makeTenantConfig({
      strictness: { lots: "STRICT" },
    });

    expect(hasOverrides(config)).toBe(true);
  });

  it("returns false for CUSTOM preset", () => {
    const config = makeTenantConfig({
      activePresetCode: "CUSTOM" as PresetCode,
    });

    expect(hasOverrides(config)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — isFieldOverridden
// ---------------------------------------------------------------------------

describe("isFieldOverridden", () => {
  it("returns false when field is not overridden", () => {
    const config = makeTenantConfig();

    expect(isFieldOverridden(config, "strictness.lots")).toBe(false);
  });

  it("returns true when field is overridden", () => {
    const config = makeTenantConfig({
      strictness: { lots: "STRICT" },
    });

    expect(isFieldOverridden(config, "strictness.lots")).toBe(true);
  });

  it("returns false for a non-existent field path", () => {
    const config = makeTenantConfig();

    expect(isFieldOverridden(config, "strictness.nonexistent")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — computeEffectiveConfig with workstationConfig
// ---------------------------------------------------------------------------

describe("computeEffectiveConfig with workstationConfig", () => {
  const testWorkstationConfig: WorkstationConfig = {
    id: "ws-config-1",
    subscriptionId: "sub-1",
    workstationId: "ws-1",
    strictness: {
      cashShiftRequired: false,
      receiptPrintRequired: "OPTIONAL",
      autoOpenDrawer: "MANUAL",
    },
    workflow: {
      autoPrintOnConfirm: false,
      printDuplicateReceipt: true,
      sessionIdleTimeoutSeconds: 1200,
    },
    createdAt: "2026-07-17T00:00:00Z",
    updatedAt: "2026-07-17T00:00:00Z",
  };

  it("overrides strictness fields with workstation values", () => {
    const config = makeTenantConfig();
    // Global config has cashShiftRequired = true (from BALANCED preset)
    // Workstation should override it to false

    const result = computeEffectiveConfig(config, testWorkstationConfig);

    expect(result.strictness.cashShiftRequired).toBe(false);
    expect(result.strictness.autoOpenDrawer).toBe("MANUAL");
  });

  it("overrides workflow fields with workstation values", () => {
    const config = makeTenantConfig();

    const result = computeEffectiveConfig(config, testWorkstationConfig);

    expect(result.workflow.printDuplicateReceipt).toBe(true);
    expect(result.workflow.sessionIdleTimeoutSeconds).toBe(1200);
  });

  it("workstation strictness overrides global stored values", () => {
    const config = makeTenantConfig({
      strictness: { cashShiftRequired: true },
    });

    const result = computeEffectiveConfig(config, testWorkstationConfig);

    // Workstation overrides even the global stored value
    expect(result.strictness.cashShiftRequired).toBe(false);
  });

  it("does not affect fiscal config (system-level)", () => {
    const config = makeTenantConfig();

    const result = computeEffectiveConfig(config, testWorkstationConfig);

    // Fiscal is system-level — workstation config should NOT touch it
    expect(result.fiscal.companyName).toBe(DEFAULT_FISCAL.companyName);
    expect(result.fiscal.defaultTaxRate).toBe(DEFAULT_FISCAL.defaultTaxRate);
  });

  it("does not affect system-level strictness fields (lots, expiry, tax, compliance)", () => {
    const config = makeTenantConfig();

    const result = computeEffectiveConfig(config, testWorkstationConfig);

    // These are system-level and NOT in the testWorkstationConfig
    expect(result.strictness.lots).toBe("OPTIONAL");
    expect(result.strictness.expiryDates).toBe("OPTIONAL");
    expect(result.strictness.prescriptionEnforcement).toBe("STRICT");
    expect(result.strictness.returnsRequireOriginalSale).toBe("STRICT");
  });

  it("returns same result as without workstationConfig when undefined", () => {
    const config = makeTenantConfig();

    const without = computeEffectiveConfig(config);
    const withUndefined = computeEffectiveConfig(config, undefined);

    expect(withUndefined).toEqual(without);
  });

  it("works with CUSTOM preset and workstation overrides", () => {
    const config = makeTenantConfig({
      activePresetCode: "CUSTOM" as PresetCode,
      strictness: { lots: "STRICT", cashShiftRequired: true },
    });

    const result = computeEffectiveConfig(config, testWorkstationConfig);

    // System-level still uses CUSTOM values
    expect(result.strictness.lots).toBe("STRICT");
    // Workstation overrides operational field
    expect(result.strictness.cashShiftRequired).toBe(false);
  });

  it("works without a preset (null activePresetCode) and workstation overrides", () => {
    const config = makeTenantConfig({
      activePresetCode: null,
      strictness: { cashShiftRequired: true },
    });

    const result = computeEffectiveConfig(config, testWorkstationConfig);

    expect(result.strictness.cashShiftRequired).toBe(false);
  });

  it("merges partial workstation overrides without affecting other fields", () => {
    const partialWsConfig: WorkstationConfig = {
      id: "ws-config-2",
      subscriptionId: "sub-1",
      workstationId: "ws-2",
      strictness: { cashShiftRequired: false },
      workflow: {},
      createdAt: "2026-07-17T00:00:00Z",
      updatedAt: "2026-07-17T00:00:00Z",
    };
    const config = makeTenantConfig();

    const result = computeEffectiveConfig(config, partialWsConfig);

    // Only cashShiftRequired should change
    expect(result.strictness.cashShiftRequired).toBe(false);
    // Other workstation-level fields remain from global config
    expect(result.strictness.autoOpenDrawer).toBe(
      PRESET_BALANCED.strictness.autoOpenDrawer,
    );
    expect(result.workflow.autoPrintOnConfirm).toBe(
      PRESET_BALANCED.workflow.autoPrintOnConfirm,
    );
  });
});
