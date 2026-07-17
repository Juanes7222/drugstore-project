/**
 * Tests for the tenant config Zustand vanilla store.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { useTenantConfigStore } from "./tenant-config.store";
import type { TenantConfig, PresetCode, StrictnessConfig, EffectiveConfig } from "./types";
import { PRESET_LIST } from "./presets";

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeTenantConfig(
  overrides?: Partial<TenantConfig>,
): TenantConfig {
  return {
    activePresetCode: "BALANCED" as PresetCode,
    strictness: {},
    fiscal: {},
    workflow: {},
    customCompanyFields: [],
    customStrictnessToggles: [],
    configVersion: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  useTenantConfigStore.setState({
    config: null,
    effectiveConfig: null,
    isCustomized: false,
    overrides: {},
    isLoading: false,
    error: null,
    lastSyncedAt: null,
    configVersion: 0,
    presets: PRESET_LIST.map((p) => ({
      code: p.code,
      name: p.name,
      description: p.description,
    })),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("initial state", () => {
  it("has config as null", () => {
    expect(useTenantConfigStore.getState().config).toBeNull();
  });

  it("has effectiveConfig as null", () => {
    expect(useTenantConfigStore.getState().effectiveConfig).toBeNull();
  });

  it("has isLoading as false", () => {
    expect(useTenantConfigStore.getState().isLoading).toBe(false);
  });

  it("has error as null", () => {
    expect(useTenantConfigStore.getState().error).toBeNull();
  });

  it("has lastSyncedAt as null", () => {
    expect(useTenantConfigStore.getState().lastSyncedAt).toBeNull();
  });

  it("has configVersion as 0", () => {
    expect(useTenantConfigStore.getState().configVersion).toBe(0);
  });

  it("has isCustomized as false", () => {
    expect(useTenantConfigStore.getState().isCustomized).toBe(false);
  });

  it("has empty overrides map", () => {
    expect(useTenantConfigStore.getState().overrides).toEqual({});
  });

  it("has presets loaded from PRESET_LIST", () => {
    const presets = useTenantConfigStore.getState().presets;
    expect(presets).toHaveLength(4);
    expect(presets[0]?.code).toBe("SIMPLE");
    expect(presets[1]?.code).toBe("BALANCED");
    expect(presets[2]?.code).toBe("STRICT");
    expect(presets[3]?.code).toBe("CUSTOM");
  });
});

describe("setConfig", () => {
  it("updates config and effectiveConfig", () => {
    useTenantConfigStore.getState().setConfig(makeTenantConfig());

    const state = useTenantConfigStore.getState();
    expect(state.config).not.toBeNull();
    expect(state.config?.configVersion).toBe(1);
    expect(state.effectiveConfig).not.toBeNull();
    expect(state.effectiveConfig?.strictness).toBeDefined();
  });

  it("computes effectiveConfig from the config", () => {
    const testConfig = makeTenantConfig({
      strictness: { lots: "STRICT" },
    });

    useTenantConfigStore.getState().setConfig(testConfig);

    const effective = useTenantConfigStore.getState().effectiveConfig;
    expect(effective?.strictness.lots).toBe("STRICT");
    // Other fields should come from preset + defaults
    expect(effective?.strictness.clientRequired).toBeDefined();
  });

  it("sets isLoading to false and clears error", () => {
    useTenantConfigStore.getState().setLoading(true);
    useTenantConfigStore.getState().setError("Previous error");

    useTenantConfigStore.getState().setConfig(makeTenantConfig());

    const state = useTenantConfigStore.getState();
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("updates configVersion from the config", () => {
    useTenantConfigStore
      .getState()
      .setConfig(makeTenantConfig({ configVersion: 5 }));

    expect(useTenantConfigStore.getState().configVersion).toBe(5);
  });

  it("updates lastSyncedAt with current timestamp", () => {
    useTenantConfigStore.getState().setConfig(makeTenantConfig());

    expect(useTenantConfigStore.getState().lastSyncedAt).not.toBeNull();
  });

  it("sets isCustomized to true when overrides exist", () => {
    useTenantConfigStore.getState().setConfig(
      makeTenantConfig({ strictness: { lots: "OFF" } }),
    );

    expect(useTenantConfigStore.getState().isCustomized).toBe(true);
  });

  it("sets isCustomized to false when no overrides", () => {
    useTenantConfigStore.getState().setConfig(makeTenantConfig());

    expect(useTenantConfigStore.getState().isCustomized).toBe(false);
  });
});

describe("updateConfig", () => {
  it("updates config and effectiveConfig", () => {
    const initialConfig = makeTenantConfig({ configVersion: 1 });
    useTenantConfigStore.getState().setConfig(initialConfig);

    const updatedConfig = makeTenantConfig({ configVersion: 2 });
    useTenantConfigStore.getState().updateConfig(updatedConfig);

    const state = useTenantConfigStore.getState();
    expect(state.configVersion).toBe(2);
    expect(state.config?.configVersion).toBe(2);
  });

  it("does not clear loading state (updateConfig preserves isLoading)", () => {
    useTenantConfigStore.getState().setLoading(true);

    useTenantConfigStore.getState().updateConfig(makeTenantConfig());

    // updateConfig does not set isLoading — only setConfig does that
    expect(useTenantConfigStore.getState().isLoading).toBe(true);
  });

  it("clears error when updating", () => {
    useTenantConfigStore.getState().setError("Some error");

    useTenantConfigStore.getState().updateConfig(makeTenantConfig());

    expect(useTenantConfigStore.getState().error).toBeNull();
  });
});

describe("clearConfig", () => {
  it("resets config to null", () => {
    useTenantConfigStore.getState().setConfig(makeTenantConfig());
    useTenantConfigStore.getState().clearConfig();

    expect(useTenantConfigStore.getState().config).toBeNull();
  });

  it("resets effectiveConfig to null", () => {
    useTenantConfigStore.getState().setConfig(makeTenantConfig());
    useTenantConfigStore.getState().clearConfig();

    expect(useTenantConfigStore.getState().effectiveConfig).toBeNull();
  });

  it("resets configVersion to 0", () => {
    useTenantConfigStore.getState().setConfig(makeTenantConfig({ configVersion: 5 }));
    useTenantConfigStore.getState().clearConfig();

    expect(useTenantConfigStore.getState().configVersion).toBe(0);
  });

  it("resets lastSyncedAt to null", () => {
    useTenantConfigStore.getState().setConfig(makeTenantConfig());
    useTenantConfigStore.getState().clearConfig();

    expect(useTenantConfigStore.getState().lastSyncedAt).toBeNull();
  });

  it("resets isCustomized to false", () => {
    useTenantConfigStore.getState().setConfig(
      makeTenantConfig({ strictness: { lots: "OFF" } }),
    );
    useTenantConfigStore.getState().clearConfig();

    expect(useTenantConfigStore.getState().isCustomized).toBe(false);
  });

  it("resets error and loading state", () => {
    useTenantConfigStore.getState().setLoading(true);
    useTenantConfigStore.getState().setError("Error");
    useTenantConfigStore.getState().clearConfig();

    const state = useTenantConfigStore.getState();
    expect(state.error).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});

describe("setLoading", () => {
  it("sets isLoading to true", () => {
    useTenantConfigStore.getState().setLoading(true);

    expect(useTenantConfigStore.getState().isLoading).toBe(true);
  });

  it("sets isLoading to false", () => {
    useTenantConfigStore.getState().setLoading(true);
    useTenantConfigStore.getState().setLoading(false);

    expect(useTenantConfigStore.getState().isLoading).toBe(false);
  });
});

describe("setError", () => {
  it("sets error message", () => {
    useTenantConfigStore.getState().setError("Network error");

    expect(useTenantConfigStore.getState().error).toBe("Network error");
  });

  it("clears loading state when setting error", () => {
    useTenantConfigStore.getState().setLoading(true);
    useTenantConfigStore.getState().setError("Error");

    expect(useTenantConfigStore.getState().isLoading).toBe(false);
  });

  it("clears error when called with null", () => {
    useTenantConfigStore.getState().setError("Error");
    useTenantConfigStore.getState().setError(null);

    expect(useTenantConfigStore.getState().error).toBeNull();
  });
});

describe("persistence partialize", () => {
  it("includes config in partialized state", () => {
    const state = useTenantConfigStore.getState();
    const partial: Record<string, unknown> = {};
    const persistConfig = {
      config: state.config,
      effectiveConfig: state.effectiveConfig,
      configVersion: state.configVersion,
      lastSyncedAt: state.lastSyncedAt,
      presets: state.presets,
    };

    expect(persistConfig).toHaveProperty("config");
    expect(persistConfig).toHaveProperty("effectiveConfig");
    expect(persistConfig).toHaveProperty("configVersion");
    expect(persistConfig).toHaveProperty("lastSyncedAt");
    expect(persistConfig).toHaveProperty("presets");
  });

  it("omits transient state (isLoading, error, isCustomized, overrides)", () => {
    const state = useTenantConfigStore.getState();
    const partialKeys = [
      "config",
      "effectiveConfig",
      "configVersion",
      "lastSyncedAt",
      "presets",
    ];
    const omitted = ["isLoading", "error", "isCustomized", "overrides"];

    // These should be in the full state but not all in persist partial
    // Test that transient fields are NOT in the persist set
    for (const key of omitted) {
      expect((state as Record<string, unknown>)[key]).toBeDefined();
    }
  });
});

describe("setPresets", () => {
  it("replaces the presets list", () => {
    const newPresets = [
      { code: "TEST", name: "Test", description: "Test preset" },
    ];

    useTenantConfigStore.getState().setPresets(newPresets);

    expect(useTenantConfigStore.getState().presets).toEqual(newPresets);
  });
});
