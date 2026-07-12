/**
 * Zustand store wrapping the local UpdateState singleton.
 *
 * Reads/writes via Prisma on PGlite to persist the update lifecycle state
 * across app restarts. Exposes the current state (version, download/install
 * status, progress, etc.) as reactive Zustand state.
 *
 * Follows the same pattern as local-config.store.ts:
 * - Vanilla Zustand store (not React-hook-based)
 * - Exports `useUpdateStore` React hook and `getUpdateStoreState()` getter
 * - Hydrates from Prisma on initialization
 *
 * The store is the single reactive source of truth for the UI layer.
 * The UpdateService owns the *logic*; the store owns the *state projection*.
 */

import { create } from 'zustand';
import type {
  UpdateType,
  UpdateChannel,
  DownloadStatus,
  InstallStatus,
} from '@pharmacy/shared-types';
import type { UpdateState } from './state-machine';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpdateStoreState {
  /** Current app version (from the running build). */
  currentVersion: string;

  /** ISO-8601 timestamp of the last check. */
  lastCheckAt: string | null;

  /** Latest available version from the server. */
  lastAvailableVersion: string | null;

  /** Type of the latest available update. */
  lastAvailableType: UpdateType | null;

  /** Changelog of the latest available update. */
  lastAvailableChangelog: string | null;

  /** Download URL of the latest available update. */
  lastAvailableDownloadUrl: string | null;

  /** File size in bytes of the latest available update. */
  lastAvailableFileSize: number | null;

  /** Download status. */
  downloadStatus: DownloadStatus | null;

  /** Download progress percentage (0–100). */
  downloadProgress: number;

  /** Download speed in bytes per second. */
  downloadSpeed: number;

  /** Install status. */
  installStatus: InstallStatus | null;

  /** Last error message. */
  lastErrorMessage: string | null;

  /** Version the user dismissed. */
  userDismissedVersion: string | null;

  /** Update channel. */
  channel: UpdateChannel;

  /** Whether to auto-download available updates. */
  autoDownload: boolean;

  /** Whether to install updates on app close. */
  installOnClose: boolean;

  /** Current state-machine state projection. */
  stateMachineState: UpdateState;

  /** Whether the update modal is currently visible. */
  showUpdateModal: boolean;

  /** Whether the progress overlay is currently visible. */
  showProgressOverlay: boolean;

  // -- Actions --

  /** Hydrate the entire store from the local Prisma UpdateState singleton. */
  hydrateFromDb(prisma: unknown): Promise<void>;

  /** Persist the current store state back to the local Prisma singleton. */
  persistToDb(prisma: unknown): Promise<void>;

  /** Update a subset of fields and persist. */
  updateAndPersist(
    prisma: unknown,
    partial: Partial<UpdateStoreState>,
  ): Promise<void>;

  /** Set the state-machine state (called by UpdateService). */
  setStateMachineState(state: UpdateState): void;

  /** Clear last error. */
  clearError(): void;

  /** Mark a version as dismissed by the user. */
  dismissVersion(version: string): void;

  // -- UI state --

  setShowUpdateModal(visible: boolean): void;
  setShowProgressOverlay(visible: boolean): void;
  setDownloadProgress(percent: number, speed: number): void;
  setDownloadStatus(status: DownloadStatus): void;
  setInstallStatus(status: InstallStatus): void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_STATE: UpdateStoreState = {
  currentVersion: '0.0.0',
  lastCheckAt: null,
  lastAvailableVersion: null,
  lastAvailableType: null,
  lastAvailableChangelog: null,
  lastAvailableDownloadUrl: null,
  lastAvailableFileSize: null,
  downloadStatus: null,
  downloadProgress: 0,
  downloadSpeed: 0,
  installStatus: null,
  lastErrorMessage: null,
  userDismissedVersion: null,
  channel: 'STABLE' as UpdateChannel,
  autoDownload: true,
  installOnClose: true,
  stateMachineState: 'IDLE' as UpdateState,
  showUpdateModal: false,
  showProgressOverlay: false,
  hydrateFromDb: async () => {},
  persistToDb: async () => {},
  updateAndPersist: async () => {},
  setStateMachineState: () => {},
  clearError: () => {},
  dismissVersion: () => {},
  setShowUpdateModal: () => {},
  setShowProgressOverlay: () => {},
  setDownloadProgress: () => {},
  setDownloadStatus: () => {},
  setInstallStatus: () => {},
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useUpdateStore = create<UpdateStoreState>()((set, get) => ({
  ...DEFAULT_STATE,

  async hydrateFromDb(prisma: unknown): Promise<void> {
    try {
      const db = prisma as any;
      const row = await db.updateState.findUnique({
        where: { id: 'singleton' },
      });

      if (!row) {
        // First launch: create default singleton
        const db = prisma as any;
        await db.updateState.create({
          data: {
            id: 'singleton',
            currentVersion: get().currentVersion,
            channel: get().channel,
            autoDownload: get().autoDownload,
            installOnClose: get().installOnClose,
          },
        });
        return;
      }

      set({
        currentVersion: row.currentVersion,
        lastCheckAt: row.lastCheckAt?.toISOString() ?? null,
        lastAvailableVersion: row.lastAvailableVersion,
        lastAvailableType: row.lastAvailableType as UpdateType | null,
        lastAvailableChangelog: row.lastAvailableChangelog,
        lastAvailableDownloadUrl: row.lastAvailableDownloadUrl,
        lastAvailableFileSize: row.lastAvailableFileSize,
        downloadStatus: row.downloadStatus as DownloadStatus | null,
        downloadProgress: row.downloadProgress,
        installStatus: row.installStatus as InstallStatus | null,
        lastErrorMessage: row.lastErrorMessage,
        userDismissedVersion: row.userDismissedVersion,
        channel: row.channel as UpdateChannel,
        autoDownload: row.autoDownload,
        installOnClose: row.installOnClose,
      });
    } catch (err) {
      console.warn('[update.store] Failed to hydrate from DB:', err);
    }
  },

  async persistToDb(prisma: unknown): Promise<void> {
    const state = get();
    const db = prisma as any;
    try {
      await db.updateState.upsert({
        where: { id: 'singleton' },
        update: {
          currentVersion: state.currentVersion,
          lastCheckAt: state.lastCheckAt ? new Date(state.lastCheckAt) : null,
          lastAvailableVersion: state.lastAvailableVersion,
          lastAvailableType: state.lastAvailableType,
          lastAvailableChangelog: state.lastAvailableChangelog,
          lastAvailableDownloadUrl: state.lastAvailableDownloadUrl,
          lastAvailableFileSize: state.lastAvailableFileSize,
          downloadStatus: state.downloadStatus,
          downloadProgress: state.downloadProgress,
          installStatus: state.installStatus,
          lastErrorMessage: state.lastErrorMessage,
          userDismissedVersion: state.userDismissedVersion,
          channel: state.channel,
          autoDownload: state.autoDownload,
          installOnClose: state.installOnClose,
        },
        create: {
          id: 'singleton',
          currentVersion: state.currentVersion,
          channel: state.channel,
          autoDownload: state.autoDownload,
          installOnClose: state.installOnClose,
        },
      });
    } catch (err) {
      console.warn('[update.store] Failed to persist to DB:', err);
    }
  },

  async updateAndPersist(
    prisma: unknown,
    partial: Partial<UpdateStoreState>,
  ): Promise<void> {
    set(partial);
    await get().persistToDb(prisma);
  },

  setStateMachineState(state: UpdateState): void {
    set({ stateMachineState: state });
  },

  clearError(): void {
    set({ lastErrorMessage: null });
  },

  dismissVersion(version: string): void {
    set({ userDismissedVersion: version });
  },

  setShowUpdateModal(visible: boolean): void {
    set({ showUpdateModal: visible });
  },

  setShowProgressOverlay(visible: boolean): void {
    set({ showProgressOverlay: visible });
  },

  setDownloadProgress(percent: number, speed: number): void {
    set({ downloadProgress: percent, downloadSpeed: speed });
  },

  setDownloadStatus(status: DownloadStatus): void {
    set({ downloadStatus: status });
  },

  setInstallStatus(status: InstallStatus): void {
    set({ installStatus: status });
  },
}));

/**
 * Convenience getter for non-React code.
 */
export const getUpdateStoreState = (): UpdateStoreState =>
  useUpdateStore.getState();
