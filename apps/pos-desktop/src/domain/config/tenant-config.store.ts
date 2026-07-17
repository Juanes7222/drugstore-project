/**
 * Zustand store for tenant configuration.
 *
 * Holds the current config, computed effective config, and loading/error state.
 * Updated by both the sync service (server push) and local config service (user edits).
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { TenantConfig, EffectiveConfig, OverrideMap, WorkstationConfig } from './types';
import { computeEffectiveConfig, getOverriddenFields, hasOverrides } from './effective-config';
import { PRESET_LIST } from './presets';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantConfigState {
  /** Raw tenant config from the server. */
  config: TenantConfig | null;

  /** Computed effective config (preset + overrides merged). */
  effectiveConfig: EffectiveConfig | null;

  /** Whether the current config has overrides from the active preset. */
  isCustomized: boolean;

  /** Which fields differ from the preset. */
  overrides: OverrideMap;

  /** Loading state. */
  isLoading: boolean;

  /** Error state. */
  error: string | null;

  /** Last successful sync timestamp (ISO-8601). */
  lastSyncedAt: string | null;

  /** Current config version (for optimistic concurrency). */
  configVersion: number;

  /** Available presets (fetched or local). */
  presets: Array<{ code: string; name: string; description: string }>;

  /** Per-workstation config overrides (from sync payload). */
  workstationConfig: WorkstationConfig | null;

  // ---- Actions ----

  /** Replace the entire config with server data and optional workstation overrides. */
  setConfig(config: TenantConfig, workstationConfig?: WorkstationConfig): void;

  /** Update the config after a successful save. */
  updateConfig(config: TenantConfig, workstationConfig?: WorkstationConfig): void;

  /** Clear config (e.g., on logout). */
  clearConfig(): void;

  /** Set loading state. */
  setLoading(isLoading: boolean): void;

  /** Set error state. */
  setError(error: string | null): void;

  /** Set presets list. */
  setPresets(presets: Array<{ code: string; name: string; description: string }>): void;
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'pharmacy_tenant_config';

export const useTenantConfigStore: StoreApi<TenantConfigState> =
  createStore<TenantConfigState>()(
    persist(
      (set) => ({
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
        workstationConfig: null,

        setConfig(config: TenantConfig, workstationConfig?: WorkstationConfig) {
          const effective = computeEffectiveConfig(config, workstationConfig);
          set((state) => ({
            config,
            workstationConfig:
              workstationConfig !== undefined
                ? workstationConfig
                : state.workstationConfig,
            effectiveConfig: effective,
            isCustomized: hasOverrides(config),
            overrides: getOverriddenFields(config),
            configVersion: config.configVersion,
            lastSyncedAt: new Date().toISOString(),
            isLoading: false,
            error: null,
          }));
        },

        updateConfig(config: TenantConfig, workstationConfig?: WorkstationConfig) {
          const effective = computeEffectiveConfig(config, workstationConfig);
          set((state) => ({
            config,
            workstationConfig:
              workstationConfig !== undefined
                ? workstationConfig
                : state.workstationConfig,
            effectiveConfig: effective,
            isCustomized: hasOverrides(config),
            overrides: getOverriddenFields(config),
            configVersion: config.configVersion,
            lastSyncedAt: new Date().toISOString(),
            error: null,
          }));
        },

        clearConfig() {
          set({
            config: null,
            effectiveConfig: null,
            workstationConfig: null,
            isCustomized: false,
            overrides: {},
            configVersion: 0,
            lastSyncedAt: null,
            isLoading: false,
            error: null,
          });
        },

        setLoading(isLoading: boolean) {
          set({ isLoading });
        },

        setError(error: string | null) {
          set({ error, isLoading: false });
        },

        setPresets(
          presets: Array<{ code: string; name: string; description: string }>,
        ) {
          set({ presets });
        },
      }),
      {
        name: STORAGE_KEY,
        storage: createJSONStorage(() => localStorage),
        // Only persist the config itself, not transient state
        partialize: (state) => ({
          config: state.config,
          effectiveConfig: state.effectiveConfig,
          configVersion: state.configVersion,
          lastSyncedAt: state.lastSyncedAt,
          presets: state.presets,
        }),
      },
    ),
  );

/**
 * Convenience getter for non-React code.
 */
export const getTenantConfigState = (): TenantConfigState =>
  useTenantConfigStore.getState();
