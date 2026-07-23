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
      // Tauri commands for local sync not yet implemented — skip polling.
      const message = error instanceof Error ? error.message : 'Failed to initialise local sync';
      // If "command not found", the Rust module isn't built yet; don't mark
      // initialized so polling loops never start.
      const isCommandMissing =
        message.includes('command not found') ||
        message.includes('not initialised') ||
        message.includes('No command');
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
      await service.forceSync();
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
}));
