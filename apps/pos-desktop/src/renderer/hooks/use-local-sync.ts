/**
 * Hook for local sync state and actions.
 *
 * Single read entry point for the local sync state in the UI.
 * Subscribes to the Zustand store and exposes actions.
 */

import { useEffect, useRef, useCallback } from 'react';
import { useLocalSyncStore } from '../store/local-sync/local-sync.store';

const POLL_INTERVAL_MS = 5_000; // 5 seconds for status refresh.
const PEER_REFRESH_INTERVAL_MS = 30_000; // 30 seconds for peer list.

export function useLocalSync() {
  const store = useLocalSyncStore();

  // Combined state for convenience.
  const state = {
    peers: store.peers,
    currentHub: store.currentHub,
    hubOverride: store.hubOverride,
    status: store.status,
    pendingPushCount: store.pendingPushCount,
    pendingPullCount: store.pendingPullCount,
    lastSyncAt: store.lastSyncAt,
    lastSyncError: store.lastSyncError,
    hubScores: store.hubScores,
    conflicts: store.conflicts,
    isEnabled: store.isEnabled,
    isInitialized: store.isInitialized,
    isLoading: store.isLoading,
  };

  // Actions.
  const initialize = useCallback(() => store.initialize(), [store]);
  const refreshPeers = useCallback(() => store.refreshPeers(), [store]);
  const refreshStatus = useCallback(() => store.refreshStatus(), [store]);
  const forceSync = useCallback(() => store.forceSync(), [store]);
  const setHubOverride = useCallback(
    (workstationId: string | null) => store.setHubOverride(workstationId),
    [store],
  );
  const setEnabled = useCallback(
    (enabled: boolean) => store.setEnabled(enabled),
    [store],
  );

  // Initialise on mount.
  const hasInitialized = useRef(false);
  useEffect(() => {
    if (!hasInitialized.current) {
      hasInitialized.current = true;
      initialize();
    }
  }, [initialize]);

  // Periodic polling for status.
  useEffect(() => {
    if (!store.isInitialized) return;

    const interval = setInterval(() => {
      refreshStatus();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [store.isInitialized, refreshStatus]);

  // Periodic peer list refresh.
  useEffect(() => {
    if (!store.isInitialized) return;

    const interval = setInterval(() => {
      refreshPeers();
    }, PEER_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [store.isInitialized, refreshPeers]);

  // Derived state.
  const isConnected = state.status === 'CONNECTED';
  const isDisconnected = state.status === 'DISCONNECTED';
  const isReconnecting = state.status === 'RECONNECTING';
  const isThisWorkstationHub = state.currentHub?.isSelf ?? false;
  const hasPendingOps = state.pendingPushCount > 0 || state.pendingPullCount > 0;

  return {
    ...state,
    // Actions
    initialize,
    refreshPeers,
    refreshStatus,
    forceSync,
    setHubOverride,
    setEnabled,
    // Derived
    isConnected,
    isDisconnected,
    isReconnecting,
    isThisWorkstationHub,
    hasPendingOps,
  };
}
