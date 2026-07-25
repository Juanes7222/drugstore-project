/**
 * React hook that subscribes to the local purchases config.
 *
 * Returns a reactive snapshot of the purchase workflow settings
 * stored in the local config store.
 */

import { useMemo } from 'react';
import { useSyncExternalStore } from 'react';
import { useLocalConfigStore } from './local-config.store';
import type { PurchasesConfig } from './local-config.store';

/**
 * Subscribe to the local purchases config.
 */
export function usePurchasesConfig(): PurchasesConfig {
  const store = useLocalConfigStore;

  const state = useSyncExternalStore(
    (onStoreChange: () => void) => {
      const unsub = store.subscribe(onStoreChange);
      return unsub;
    },
    () => store.getState().purchasesConfig,
  );

  return useMemo(() => state, [state]);
}

/**
 * Convenience hook that returns only the lot-on-reception flag.
 */
export function useRequireLotOnReception(): boolean {
  const purchasesConfig = usePurchasesConfig();
  return purchasesConfig.requireLotOnReception;
}

/**
 * Convenience hook that returns only the expiry-on-reception flag.
 */
export function useRequireExpiryOnReception(): boolean {
  const purchasesConfig = usePurchasesConfig();
  return purchasesConfig.requireExpiryOnReception;
}

export type { PurchasesConfig } from './local-config.store';
