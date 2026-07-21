/**
 * Local sync service.
 *
 * Wraps Tauri commands for local sync management. Provides typed
 * methods that the store and hooks consume.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  DiscoveredPeer,
  HubInfo,
  HubScore,
  LocalSyncStatus,
  LocalOperation,
} from '@pharmacy/shared-types';

export interface InitializeLocalSyncParams {
  workstationId: string;
  friendlyName: string;
  hubEligible: boolean;
  localNetworkKey: string;
  hostIp: string;
  port?: number;
}

export interface LocalSyncService {
  /** Initialise local sync modules with real config (called after app start). */
  initializeLocalSync(params: InitializeLocalSyncParams): Promise<void>;

  /** Get list of discovered LAN workstations. */
  getPeers(): Promise<DiscoveredPeer[]>;

  /** Trigger an immediate mDNS re-scan. */
  forceRediscovery(): Promise<DiscoveredPeer[]>;

  /** Get current local sync status. */
  getStatus(): Promise<LocalSyncStatus>;

  /** Force an immediate push + pull sync cycle. */
  forceSync(): Promise<void>;

  /** Get the currently elected hub. */
  getCurrentHub(): Promise<HubInfo | null>;

  /** Get hub scores for all peers. */
  getHubScores(): Promise<HubScore[]>;

  /** Set a hub override. Pass `null` to clear. */
  setHubOverride(workstationId: string | null): Promise<void>;

  /** Start the hub HTTP server (hub role only). */
  startHubServer(): Promise<void>;

  /** Stop the hub HTTP server. */
  stopHubServer(): Promise<void>;

  /** Push operations to the current hub. */
  pushToHub(operations: LocalOperation[]): Promise<PushResponse>;

  /** Pull operations from the current hub. */
  pullFromHub(): Promise<PullResponse>;

  /** Enable or disable local network sync. */
  setLocalSyncEnabled(enabled: boolean): Promise<void>;

  /** Get hub conflicts. */
  getHubConflicts(): Promise<ConflictInfo[]>;
}

export interface PushResponse {
  accepted: number;
  rejected: number;
  conflicts: ConflictInfo[];
}

export interface PullResponse {
  operations: LocalOperation[];
  nextSince: string;
}

export interface ConflictInfo {
  operationUuid: string;
  reason: string;
  winningOperationUuid: string;
}

/**
 * Create a LocalSyncService backed by Tauri invoke commands.
 */
export function createLocalSyncService(): LocalSyncService {
  return {
    async initializeLocalSync(params: InitializeLocalSyncParams): Promise<void> {
      await invoke<void>('initialize_local_sync', {
        workstationId: params.workstationId,
        friendlyName: params.friendlyName,
        hubEligible: params.hubEligible,
        localNetworkKey: params.localNetworkKey,
        hostIp: params.hostIp,
        port: params.port ?? null,
      });
    },

    async getPeers(): Promise<DiscoveredPeer[]> {
      return invoke<DiscoveredPeer[]>('get_discovered_peers');
    },

    async forceRediscovery(): Promise<DiscoveredPeer[]> {
      return invoke<DiscoveredPeer[]>('force_rediscovery');
    },

    async getStatus(): Promise<LocalSyncStatus> {
      return invoke<LocalSyncStatus>('get_local_sync_status');
    },

    async forceSync(): Promise<void> {
      await invoke<void>('force_local_sync');
    },

    async getCurrentHub(): Promise<HubInfo | null> {
      return invoke<HubInfo | null>('get_current_hub');
    },

    async getHubScores(): Promise<HubScore[]> {
      return invoke<HubScore[]>('get_hub_scores');
    },

    async setHubOverride(workstationId: string | null): Promise<void> {
      await invoke<void>('set_hub_override', { workstationId });
    },

    async startHubServer(): Promise<void> {
      await invoke<void>('start_hub_server');
    },

    async stopHubServer(): Promise<void> {
      await invoke<void>('stop_hub_server');
    },

    async pushToHub(operations: LocalOperation[]): Promise<PushResponse> {
      return invoke<PushResponse>('push_to_hub', { operations });
    },

    async pullFromHub(): Promise<PullResponse> {
      return invoke<PullResponse>('pull_from_hub');
    },

    async setLocalSyncEnabled(enabled: boolean): Promise<void> {
      await invoke<void>('set_local_sync_enabled', { enabled });
    },

    async getHubConflicts(): Promise<ConflictInfo[]> {
      return invoke<ConflictInfo[]>('get_hub_conflicts');
    },
  };
}
