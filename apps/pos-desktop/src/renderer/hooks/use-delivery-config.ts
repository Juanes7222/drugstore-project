/**
 * React subscription to the effective delivery (domicilio) tenant policy.
 *
 * Thin presentational adapter over the tenant-config Zustand store (owned
 * by the config domain module). Falls back to the feature-disabled defaults
 * while the config is loading or never synced — the same fallback the
 * sales-pos service uses via `getEffectiveDeliveryConfig()`.
 */

import { useCallback, useMemo } from "react";
import { useSyncExternalStore } from "react";
import { useTenantConfigStore } from "../../domain/config/tenant-config.store";
import { DEFAULT_DELIVERY } from "../../domain/config/defaults";
import type { DeliveryConfig } from "../../domain/config/types";

/**
 * @returns The current effective `DeliveryConfig`, or the disabled-feature
 * defaults when the tenant config is not loaded yet.
 */
export function useDeliveryConfig(): DeliveryConfig {
  const store = useTenantConfigStore;

  // Same tear-free subscription pattern as use-tenant-config.
  const state = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => store.subscribe(onStoreChange),
      [store],
    ),
    useCallback(() => store.getState(), [store]),
  );

  return useMemo(
    () => state.effectiveConfig?.workflow.delivery ?? DEFAULT_DELIVERY,
    [state.effectiveConfig],
  );
}
