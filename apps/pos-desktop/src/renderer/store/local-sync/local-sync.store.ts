/**
 * Local sync Zustand store.
 *
 * Holds the reactive state for local network sync: discovered peers,
 * current hub, sync status, pending counts, and errors.
 *
 * This is the single source of truth for the local sync state in the UI.
 */

import { create } from 'zustand';
import type {
  DiscoveredPeer,
  HubInfo,
  HubScore,
  LocalSyncConnectionStatus,
} from '@pharmacy/shared-types';

import {
  createLocalSyncService,
  type InitializeLocalSyncParams,
} from '../../services/local-sync/local-sync.service';
import type { ConflictInfo } from '../../services/local-sync/local-sync.service';
import type { LocalSyncCycleResult } from '../../../domain/local-sync/local-sync-engine.service';
import { getLocalSyncEngine } from '../../../domain/local-sync/local-sync-engine-holder';

export interface LocalSyncState {
  /** List of discovered LAN workstations. */
  peers: DiscoveredPeer[];
  /** Currently elected hub. */
  currentHub: HubInfo | null;
  /** Hub override (null = auto-election). */
  hubOverride: string | null;
  /** Current sync status. */
  status: LocalSyncConnectionStatus;
  /** Number of pending push operations. */
  pendingPushCount: number;
  /** Number of pending pull operations. */
  pendingPullCount: number;
  /** Last successful sync timestamp (ISO string). */
  lastSyncAt: string | null;
  /** Last sync error message. */
  lastSyncError: string | null;
  /**
   * Outcome of the last automatic LAN relay cycle (`ok`, `skipped-no-hub`,
   * `skipped-backoff`, `error`, or null before the first cycle). Untouched
   * by status polls so the UI can render sticky states like backoff without
   * flicker. The page maps it to the LanHubCard `isBackoff` prop.
   */
  lastCycleOutcome: LocalSyncCycleResult['outcome'] | null;
  /** Hub scores for all peers. */
  hubScores: HubScore[];
  /** Recent sync conflicts. */
  conflicts: ConflictInfo[];
  /** Whether the local network is enabled. */
  isEnabled: boolean;
  /** Whether the store has been initialised. */
  isInitialized: boolean;
  /** Loading state for async operations. */
  isLoading: boolean;
}

export interface LocalSyncStoreActions {
  /** Initialise local sync modules and fetch initial state.
   *  @param params - Required for first call to configure Rust modules.
   *                  Omit (or call without params) during re-initialisation
   *                  if already configured. */
  initialize: (params?: InitializeLocalSyncParams) => Promise<void>;
  /** Refresh the peer list from mDNS. */
  refreshPeers: () => Promise<void>;
  /** Refresh the sync status from the Tauri backend. */
  refreshStatus: () => Promise<void>;
  /** Force an immediate sync cycle. */
  forceSync: () => Promise<void>;
  /** Set a hub override. */
  setHubOverride: (workstationId: string | null) => Promise<void>;
  /** Enable or disable local network sync. */
  setEnabled: (enabled: boolean) => Promise<void>;
  /** Refresh hub scores. */
  refreshHubScores: () => Promise<void>;
  /** Refresh conflicts list. */
  refreshConflicts: () => Promise<void>;
  /** Reflect one automatic LAN relay cycle outcome into the UI state. */
  applyCycleResult: (result: LocalSyncCycleResult) => void;
}

export type LocalSyncStore = LocalSyncState & LocalSyncStoreActions;

const service = createLocalSyncService();

const initialState: LocalSyncState = {
  peers: [],
  currentHub: null,
  hubOverride: null,
  status: 'DISCONNECTED' as LocalSyncConnectionStatus,
  pendingPushCount: 0,
  pendingPullCount: 0,
  lastSyncAt: null,
  lastSyncError: null,
  hubScores: [],
  conflicts: [],
  isEnabled: true,
  isInitialized: false,
  isLoading: false,
  lastCycleOutcome: null,
};

export const useLocalSyncStore = create<LocalSyncStore>((set, get) => ({
  ...initialState,

  async initialize(params?: InitializeLocalSyncParams) {
    try {
      set({ isLoading: true });

      if (params) {
        await service.initializeLocalSync(params);
      }

      const [peers, status, hub] = await Promise.all([
        service.getPeers(),
        service.getStatus(),
        service.getCurrentHub(),
      ]);

      console.log('[local-sync-store] initialize peers', peers.length, 'hub', hub?.workstationId, 'status', status.connectionStatus);
      set({
        peers,
        status: status.connectionStatus,
        currentHub: hub,
        pendingPushCount: status.pendingPushCount,
        pendingPullCount: status.pendingPullCount,
        lastSyncAt: status.lastSyncAt,
        lastSyncError: status.lastError,
        isInitialized: true,
        isLoading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to initialise local sync';
      console.error('[local-sync-store] initialize failed', message, error);

      // "command not found" / "No command" — the Tauri command does not exist
      // in the Rust binary at all (build mismatch).  Keep isInitialized false
      // so the polling loop never starts.
      const isCommandMissing =
        message.includes('command not found') ||
        message.includes('No command');

      // "not initialised" — the Tauri command exists but the lazy module
      // (LocalSyncModules) hasn't been populated yet via
      // initialize_local_sync.  That happens in initializeServices() once
      // workstation config is loaded.  Until then, keep isInitialized false
      // so the polling loop does not start and spam the console.
      const isLazyNotInit = message.includes('not initialised');

      if (isLazyNotInit) {
        // Rust modules not yet ready (race between useLocalSync mount and
        // initializeServices). Retry after 1s instead of staying forever
        // uninitialized — this was the root cause of "Sin hub designado"
        // persisting even though Rust had already elected ws_principal.
        console.log('[local-sync-store] retry initialize in 1s (lazy not init)');
        set({ isLoading: false });
        setTimeout(() => void get().initialize(), 1000);
        return;
      }

      set({
        isInitialized: !isCommandMissing,
        isLoading: false,
        lastSyncError: isCommandMissing ? null : message,
      });
    }
  },

  async refreshPeers() {
    try {
      const peers = await service.forceRediscovery();
      console.log('[local-sync-store] refreshPeers', peers.length, peers.map((p) => p.workstationId));
      set({ peers });
    } catch (error) {
      console.error('Failed to refresh peers:', error);
    }
  },

  async refreshStatus() {
    try {
      const [status, hub] = await Promise.all([
        service.getStatus(),
        service.getCurrentHub(),
      ]);
      console.log('[local-sync-store] refreshStatus hub', hub?.workstationId, 'isSelf', hub?.isSelf, 'status', status.connectionStatus, 'addr', status.currentHubAddress);

      set({
        status: status.connectionStatus,
        currentHub: hub,
        pendingPushCount: status.pendingPushCount,
        pendingPullCount: status.pendingPullCount,
        lastSyncAt: status.lastSyncAt,
        lastSyncError: status.lastError,
      });
    } catch (error) {
      console.error('Failed to refresh status:', error);
    }
  },

  async forceSync() {
    try {
      set({ isLoading: true });
      // Drive the startup engine's full push+pull cycle when available —
      // that is the real LAN sync. The Rust `force_local_sync` command only
      // pulls (it cannot read the PGlite outbox), so it runs as a
      // complement, never as the whole story.
      const engine = getLocalSyncEngine();
      if (engine) {
        const result = await engine.runCycle();
        get().applyCycleResult(result);
      } else {
        await service.forceSync();
      }
      await get().refreshStatus();
    } catch (error) {
      set({
        lastSyncError: error instanceof Error ? error.message : 'Force sync failed',
      });
    } finally {
      set({ isLoading: false });
    }
  },

  async setHubOverride(workstationId: string | null) {
    try {
      await service.setHubOverride(workstationId);
      set({ hubOverride: workstationId });
      await get().refreshStatus();
    } catch (error) {
      console.error('Failed to set hub override:', error);
    }
  },

  async setEnabled(enabled: boolean) {
    try {
      await service.setLocalSyncEnabled(enabled);
      set({ isEnabled: enabled });
    } catch (error) {
      console.error('Failed to set local sync enabled:', error);
    }
  },

  async refreshHubScores() {
    try {
      const hubScores = await service.getHubScores();
      set({ hubScores });
    } catch (error) {
      console.error('Failed to refresh hub scores:', error);
    }
  },

  async refreshConflicts() {
    try {
      const conflicts = await service.getHubConflicts();
      set({ conflicts });
    } catch (error) {
      console.error('Failed to refresh conflicts:', error);
    }
  },

  applyCycleResult(result: LocalSyncCycleResult) {
    if (result.outcome === 'ok') {      // Prefer the engine's real post-cycle count over decrementing a
      // possibly-stale counter: the Rust status counters are informational
      // (always zero) and retries make subtraction drift.
      const pendingPushCount =
        result.pendingNotRelayed ?? Math.max(0, get().pendingPushCount - result.pushedToHub);
      // A duplicated workstation ID silently drops a peer's operations —
      // surface it loudly until the operator fixes the identity.
      // English code-style message (UI translates via i18n key
      // `sync.duplicate_workstation_id`, see frontend-pos follow-up).
      const identityError =
        (result.identityCollisions ?? 0) > 0
          ? `DUPLICATE_WORKSTATION_ID:${result.identityCollisions}`
          : null;
      set({
        lastSyncAt: result.ranAt,
        lastSyncError: identityError,
        pendingPushCount,
        lastCycleOutcome: result.outcome,
      });
      return;
    }

    if (result.outcome === 'error') {
      set({
        lastSyncError: result.errorMessage ?? 'LAN sync cycle failed',
        lastCycleOutcome: result.outcome,
      });
      return;
    }
    // 'skipped-no-hub' leaves the error untouched: not having a hub
    // is a normal state for a single-terminal store, not an error.
    // 'skipped-backoff' likewise: the hub asked us to wait and the next
    // scheduled cycle retries on its own — no operator action needed.
    // Both still record the outcome so the UI can render the backoff
    // waiting state without flicker.
    set({ lastCycleOutcome: result.outcome });
  },
}));
