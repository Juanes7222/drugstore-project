/**
 * React hook for tenant configuration.
 *
 * Single entry point for all config reads in component code.
 * Subscribes to the Zustand store and exposes actions via ConfigService.
 *
 * When no `configService` is provided (the common case), one is auto-created
 * using the app's default API base URL and the current session's access token.
 * Callers can inject a mock for testing.
 */

import { useCallback, useEffect, useMemo } from 'react';
import { useSyncExternalStore } from 'react';
import { useTenantConfigStore } from './tenant-config.store';
import type { ConfigService } from './config.service';
import type {
  TenantConfig,
  EffectiveConfig,
  PresetCode,
  CustomCompanyField,
  CustomStrictnessToggle,
} from './types';
import {
  createConfigService,
  createDefaultConfigHttpClient,
  ConfigHttpError,
} from './config.service';
import { API_BASE_URL } from '../../infrastructure/config';
import { useLocalSessionStore } from '../auth/local-session.store';
import {
  DEFAULT_STRICTNESS,
  DEFAULT_FISCAL,
  DEFAULT_WORKFLOW,
} from './defaults';

// ---------------------------------------------------------------------------
// Default config factory — used when server returns 404
// ---------------------------------------------------------------------------

function createDefaultTenantConfig(
  subscriptionId: string | null,
): TenantConfig {
  return {
    id: '',
    subscriptionId: subscriptionId ?? '',
    activePresetCode: null,
    strictness: { ...DEFAULT_STRICTNESS },
    fiscal: { ...DEFAULT_FISCAL },
    workflow: { ...DEFAULT_WORKFLOW },
    customCompanyFields: [],
    customStrictnessToggles: [],
    configVersion: 0,
    lastModifiedByUserId: '',
    lastModifiedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Default ConfigService factory — reads session token at call time
// ---------------------------------------------------------------------------

function createDefaultConfigService(): ConfigService {
  return createConfigService({
    httpClient: createDefaultConfigHttpClient({
      baseUrl: API_BASE_URL,
      getAccessToken: async () => {
        const session = useLocalSessionStore.getState().session;
        return session?.accessToken ?? null;
      },
    }),
  });
}

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
  updateCustomField: (
    fieldId: string,
    updates: Partial<CustomCompanyField>,
  ) => Promise<void>;

  /** Remove a custom company field. */
  removeCustomField: (fieldId: string) => Promise<void>;

  /** Add a custom strictness toggle. */
  addCustomToggle: (toggle: CustomStrictnessToggle) => Promise<void>;

  /** Update a custom strictness toggle. */
  updateCustomToggle: (
    toggleId: string,
    updates: Partial<CustomStrictnessToggle>,
  ) => Promise<void>;

  /** Remove a custom strictness toggle. */
  removeCustomToggle: (toggleId: string) => Promise<void>;
}

/**
 * Subscribe to tenant config store and expose actions.
 *
 * When called without arguments (the standard case), a ConfigService is
 * auto-created using `API_BASE_URL` and the current session's access token.
 * Pass a mock `configService` for testing or to override the HTTP client.
 */
export function useTenantConfig(
  configService?: ConfigService,
): UseTenantConfigResult {
  const store = useTenantConfigStore;

  // Resolve service — auto-create default when none injected.
  // useMemo keeps the instance stable across renders unless configService changes.
  const svc = useMemo(
    () => configService ?? createDefaultConfigService(),
    [configService],
  );

  // Subscribe to Zustand store using useSyncExternalStore for tear-free reads
  const state = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => {
        const unsub = store.subscribe(onStoreChange);
        return unsub;
      },
      [store],
    ),
    useCallback(() => store.getState(), [store]),
  );

  // ---- Actions ----

  const refresh = useCallback(async () => {
    store.getState().setLoading(true);
    try {
      const config = await svc.getCurrent();
      store.getState().setConfig(config);
    } catch (err) {
      if (err instanceof ConfigHttpError && err.statusCode === 404) {
        // No config on server yet — seed with defaults.
        // This is expected for brand-new subscriptions.
        const session = useLocalSessionStore.getState().session;
        store
          .getState()
          .setConfig(
            createDefaultTenantConfig(session?.subscriptionId ?? null),
          );
      } else {
        const message =
          err instanceof Error ? err.message : 'Failed to fetch config';
        store.getState().setError(message);
      }
    }
  }, [svc, store]);

  const applyPreset = useCallback(
    async (code: PresetCode) => {
      store.getState().setLoading(true);
      try {
        const config = await svc.applyPreset(code);
        store.getState().setConfig(config);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to apply preset';
        store.getState().setError(message);
      }
    },
    [svc, store],
  );

  const resetToPreset = useCallback(async () => {
    store.getState().setLoading(true);
    try {
      const config = await svc.resetToPreset();
      store.getState().setConfig(config);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to reset to preset';
      store.getState().setError(message);
    }
  }, [svc, store]);

  const update = useCallback(
    async (updates: Partial<TenantConfig>) => {
      const currentVersion = store.getState().configVersion;
      store.getState().setLoading(true);
      try {
        const config = await svc.update(updates, currentVersion);
        store.getState().setConfig(config);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update config';
        store.getState().setError(message);
      }
    },
    [svc, store],
  );

  const addCustomField = useCallback(
    async (field: CustomCompanyField) => {
      try {
        const config = await svc.addCustomField(field);
        store.getState().setConfig(config);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to add custom field';
        store.getState().setError(message);
      }
    },
    [svc, store],
  );

  const updateCustomField = useCallback(
    async (fieldId: string, updates: Partial<CustomCompanyField>) => {
      try {
        const config = await svc.updateCustomField(fieldId, updates);
        store.getState().setConfig(config);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to update custom field';
        store.getState().setError(message);
      }
    },
    [svc, store],
  );

  const removeCustomField = useCallback(
    async (fieldId: string) => {
      try {
        const config = await svc.removeCustomField(fieldId);
        store.getState().setConfig(config);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to remove custom field';
        store.getState().setError(message);
      }
    },
    [svc, store],
  );

  const addCustomToggle = useCallback(
    async (toggle: CustomStrictnessToggle) => {
      try {
        const config = await svc.addCustomToggle(toggle);
        store.getState().setConfig(config);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to add custom toggle';
        store.getState().setError(message);
      }
    },
    [svc, store],
  );

  const updateCustomToggle = useCallback(
    async (toggleId: string, updates: Partial<CustomStrictnessToggle>) => {
      try {
        const config = await svc.updateCustomToggle(toggleId, updates);
        store.getState().setConfig(config);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to update custom toggle';
        store.getState().setError(message);
      }
    },
    [svc, store],
  );

  const removeCustomToggle = useCallback(
    async (toggleId: string) => {
      try {
        const config = await svc.removeCustomToggle(toggleId);
        store.getState().setConfig(config);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to remove custom toggle';
        store.getState().setError(message);
      }
    },
    [svc, store],
  );

  // ---- Auto-refresh on first mount ----

  useEffect(() => {
    if (!store.getState().config && !store.getState().isLoading) {
      refresh();
    }
    // Run once per component mount.  refresh is stable (depends on svc which
    // is useMemo'd and store which never changes), so the deps array is
    // effectively the same as [].
  }, [refresh]);

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
