/**
 * React hook for tenant configuration.
 *
 * Single entry point for all config reads in component code.
 * Subscribes to the Zustand store and exposes actions via ConfigService.
 */

import { useCallback } from 'react';
import { useSyncExternalStore } from 'react';
import { useTenantConfigStore } from './tenant-config.store';
import type { ConfigService } from './config.service';
import type { TenantConfig, EffectiveConfig, PresetCode, CustomCompanyField, CustomStrictnessToggle } from './types';

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export interface UseTenantConfigResult {
  /** Raw tenant config from server. */
  config: TenantConfig | null;

  /** Computed effective config (preset + overrides merged). */
  effectiveConfig: EffectiveConfig | null;

  /** Whether the config has manual overrides from the active preset. */
  isCustomized: boolean;

  /** Loading state. */
  isLoading: boolean;

  /** Error message. */
  error: string | null;

  /** Current config version (for optimistic concurrency). */
  configVersion: number;

  /** Last sync timestamp. */
  lastSyncedAt: string | null;

  // ---- Actions ----

  /** Fetch the latest config from the server. */
  refresh: () => Promise<void>;

  /** Apply a standard preset. */
  applyPreset: (code: PresetCode) => Promise<void>;

  /** Reset to active preset values. */
  resetToPreset: () => Promise<void>;

  /** Update config fields. */
  update: (updates: Partial<TenantConfig>) => Promise<void>;

  /** Add a custom company field. */
  addCustomField: (field: CustomCompanyField) => Promise<void>;

  /** Update a custom company field. */
  updateCustomField: (fieldId: string, updates: Partial<CustomCompanyField>) => Promise<void>;

  /** Remove a custom company field. */
  removeCustomField: (fieldId: string) => Promise<void>;

  /** Add a custom strictness toggle. */
  addCustomToggle: (toggle: CustomStrictnessToggle) => Promise<void>;

  /** Update a custom strictness toggle. */
  updateCustomToggle: (toggleId: string, updates: Partial<CustomStrictnessToggle>) => Promise<void>;

  /** Remove a custom strictness toggle. */
  removeCustomToggle: (toggleId: string) => Promise<void>;
}

/**
 * Subscribe to tenant config store and expose actions.
 * Requires ConfigService to be provided via callback.
 */
export function useTenantConfig(configService?: ConfigService): UseTenantConfigResult {
  const store = useTenantConfigStore;

  // Subscribe to Zustand store using useSyncExternalStore for tear-free reads
  const state = useSyncExternalStore(
    useCallback((onStoreChange: () => void) => {
      const unsub = store.subscribe(onStoreChange);
      return unsub;
    }, [store]),
    useCallback(() => store.getState(), [store]),
  );

  // ---- Actions ----

  const refresh = useCallback(async () => {
    if (!configService) return;
    store.getState().setLoading(true);
    try {
      const config = await configService.getCurrent();
      store.getState().setConfig(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch config';
      store.getState().setError(message);
    }
  }, [configService, store]);

  const applyPreset = useCallback(
    async (code: PresetCode) => {
      if (!configService) return;
      store.getState().setLoading(true);
      try {
        const config = await configService.applyPreset(code);
        store.getState().setConfig(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to apply preset';
        store.getState().setError(message);
      }
    },
    [configService, store],
  );

  const resetToPreset = useCallback(async () => {
    if (!configService) return;
    store.getState().setLoading(true);
    try {
      const config = await configService.resetToPreset();
      store.getState().setConfig(config);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to reset to preset';
      store.getState().setError(message);
    }
  }, [configService, store]);

  const update = useCallback(
    async (updates: Partial<TenantConfig>) => {
      if (!configService) return;
      const currentVersion = store.getState().configVersion;
      store.getState().setLoading(true);
      try {
        const config = await configService.update(updates, currentVersion);
        store.getState().setConfig(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update config';
        store.getState().setError(message);
      }
    },
    [configService, store],
  );

  const addCustomField = useCallback(
    async (field: CustomCompanyField) => {
      if (!configService) return;
      try {
        const config = await configService.addCustomField(field);
        store.getState().setConfig(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add custom field';
        store.getState().setError(message);
      }
    },
    [configService, store],
  );

  const updateCustomField = useCallback(
    async (fieldId: string, updates: Partial<CustomCompanyField>) => {
      if (!configService) return;
      try {
        const config = await configService.updateCustomField(fieldId, updates);
        store.getState().setConfig(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update custom field';
        store.getState().setError(message);
      }
    },
    [configService, store],
  );

  const removeCustomField = useCallback(
    async (fieldId: string) => {
      if (!configService) return;
      try {
        const config = await configService.removeCustomField(fieldId);
        store.getState().setConfig(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove custom field';
        store.getState().setError(message);
      }
    },
    [configService, store],
  );

  const addCustomToggle = useCallback(
    async (toggle: CustomStrictnessToggle) => {
      if (!configService) return;
      try {
        const config = await configService.addCustomToggle(toggle);
        store.getState().setConfig(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to add custom toggle';
        store.getState().setError(message);
      }
    },
    [configService, store],
  );

  const updateCustomToggle = useCallback(
    async (toggleId: string, updates: Partial<CustomStrictnessToggle>) => {
      if (!configService) return;
      try {
        const config = await configService.updateCustomToggle(toggleId, updates);
        store.getState().setConfig(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update custom toggle';
        store.getState().setError(message);
      }
    },
    [configService, store],
  );

  const removeCustomToggle = useCallback(
    async (toggleId: string) => {
      if (!configService) return;
      try {
        const config = await configService.removeCustomToggle(toggleId);
        store.getState().setConfig(config);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to remove custom toggle';
        store.getState().setError(message);
      }
    },
    [configService, store],
  );

  return {
    config: state.config,
    effectiveConfig: state.effectiveConfig,
    isCustomized: state.isCustomized,
    isLoading: state.isLoading,
    error: state.error,
    configVersion: state.configVersion,
    lastSyncedAt: state.lastSyncedAt,
    refresh,
    applyPreset,
    resetToPreset,
    update,
    addCustomField,
    updateCustomField,
    removeCustomField,
    addCustomToggle,
    updateCustomToggle,
    removeCustomToggle,
  };
}
