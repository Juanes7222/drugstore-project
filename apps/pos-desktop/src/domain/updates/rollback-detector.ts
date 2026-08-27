/**
 * Rollback detector for the POS desktop auto-update module.
 *
 * Detects when a newly installed version has failed to start correctly
 * by monitoring a sentinel file and crash counters. If the app crashes
 * within the first 60 seconds of startup for 3 consecutive attempts,
 * the detector recommends a rollback to the previous version.
 *
 * Works alongside Tauri's native rollback mechanism and the app's own
 * startup-health check infrastructure.
 */

import { invoke } from '@tauri-apps/api/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RollbackDetectorConfig {
  /** PrismaClient for reading/writing local update state. */
  prisma: unknown;
  /** The current app version (from the running build). */
  currentVersion: string;
  /**
   * Returns the identity of the current local database install, or null
   * when unknown (database not initialized yet, or in-memory dev mode).
   * The crash counter is scoped to one database install: a sentinel
   * written by a different install (the DB was wiped or recreated) is
   * stale and must not feed the crash-loop decision.
   */
  databaseInstallId?: () => string | null;
  /**
   * Optional callback invoked when rollback is recommended.
   * The caller (e.g. UpdateService) performs the actual rollback.
   */
  onRollbackRecommended?: (reason: string) => void;
}

export interface RollbackDetector {
  /**
   * Check whether the previous version crashed on startup.
   * Must be called once during app initialisation, after the DB is ready
   * and before the main UI renders.
   */
  checkForRollback(): Promise<{ needsRollback: boolean; reason: string | null }>;

  /**
   * Mark a successful startup so the sentinel is cleared.
   * Should be called after the app has been running stably for 60 seconds.
   */
  markStartupSuccess(): Promise<void>;

  /**
   * Reset the crash counter (e.g. after a rollback is performed).
   */
  resetCrashCount(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STABILITY_WINDOW_MS = 60_000; // 60 seconds
const MAX_CONSECUTIVE_CRASHES = 3;
const SENTINEL_KEY = '.last-update-startup';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRollbackDetector(config: RollbackDetectorConfig): RollbackDetector {
  return new RollbackDetectorImpl(config);
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class RollbackDetectorImpl implements RollbackDetector {
  private readonly onRollbackRecommended?: (reason: string) => void;
  private readonly databaseInstallId?: () => string | null;

  constructor(private readonly config: RollbackDetectorConfig) {
    this.onRollbackRecommended = config.onRollbackRecommended;
    this.databaseInstallId = config.databaseInstallId;
  }

  async checkForRollback(): Promise<{
    needsRollback: boolean;
    reason: string | null;
  }> {
    const isTauriEnv =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    try {
      // 1. Read or create the sentinel file (tracks startup attempts)
      let startupCount = 0;
      let lastVersion = '';
      let sentinelInstallId: string | null = null;

      if (isTauriEnv) {
        const sentinelData = await invoke<{
          count: number;
          version: string;
          dbInstallId?: string | null;
        }>('read_sentinel_command', {
          key: SENTINEL_KEY,
        });
        startupCount = sentinelData.count;
        lastVersion = sentinelData.version;
        sentinelInstallId = sentinelData.dbInstallId ?? null;
      } else {
        // Dev fallback: use sessionStorage
        const raw = sessionStorage.getItem(SENTINEL_KEY);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as {
              count: number;
              version: string;
              dbInstallId?: string | null;
            };
            startupCount = parsed.count;
            lastVersion = parsed.version;
            sentinelInstallId = parsed.dbInstallId ?? null;
          } catch {
            // Ignore parse errors
          }
        }
        lastVersion = lastVersion || this.config.currentVersion;
      }

      // 2. A sentinel from a different database install describes crashes of
      // an installation that no longer exists (the DB was wiped or
      // recreated). Reset instead of inheriting its count — otherwise a
      // wiped database leaves a permanently poisoned crash-loop signal.
      // Comparison only fires when both ids are known; an unknown id keeps
      // the legacy version-only behavior.
      const currentInstallId = this.databaseInstallId?.() ?? null;
      if (
        sentinelInstallId &&
        currentInstallId &&
        sentinelInstallId !== currentInstallId
      ) {
        console.warn(
          '[rollback-detector] Local database install changed — resetting stale crash counter.',
        );
        await this.writeSentinel(1);

        this.scheduleStabilityClear();
        return { needsRollback: false, reason: null };
      }

      // 3. If this is a different version from the sentinel, reset counter
      if (lastVersion && lastVersion !== this.config.currentVersion) {
        // The version changed (new update installed) — this is the first run.
        // Increment the counter (this call itself IS a startup attempt).
        startupCount = 1;
        await this.writeSentinel(startupCount);

        this.scheduleStabilityClear();

        return {
          needsRollback: false,
          reason: null,
        };
      }

      // 4. Same version — increment crash counter
      startupCount += 1;
      await this.writeSentinel(startupCount);

      // If this is the first startup of an existing version, set stability timer
      if (startupCount <= 1) {
        this.scheduleStabilityClear();
      }

      // 5. Check if we've exceeded the crash threshold
      if (startupCount > MAX_CONSECUTIVE_CRASHES) {
        const reason = `App crashed ${startupCount} consecutive times on version ${this.config.currentVersion}.`;
        console.error(`[rollback-detector] ${reason}`);

        this.onRollbackRecommended?.(reason);

        return {
          needsRollback: true,
          reason,
        };
      }

      return {
        needsRollback: false,
        reason: null,
      };
    } catch (err) {
      // If sentinel read/write fails, assume safe (no rollback needed).
      console.warn('[rollback-detector] Sentinel check failed:', err);
      return { needsRollback: false, reason: null };
    }
  }

  async markStartupSuccess(): Promise<void> {
    try {
      // Clear the sentinel — startup is stable.
      await this.writeSentinel(0);
    } catch (err) {
      console.warn('[rollback-detector] Failed to clear sentinel:', err);
    }
  }

  async resetCrashCount(): Promise<void> {
    try {
      await this.writeSentinel(0);
    } catch (err) {
      console.warn('[rollback-detector] Failed to reset crash count:', err);
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Set a one-shot timer to clear the sentinel after 60 seconds of stable
   * uptime. In Tauri the sentinel outlives the process; if the app crashes
   * first, the timer never fires and the count stands. In dev (sessionStorage)
   * we also arm it so the 451-counter spam seen in Vite dev resets after 60s
   * stable instead of poisoning every reload.
   */
  private scheduleStabilityClear(): void {
    setTimeout(async () => {
      try {
        await this.markStartupSuccess();
      } catch {
        // Ignore cleanup errors.
      }
    }, STABILITY_WINDOW_MS);
  }

  private async writeSentinel(count: number): Promise<void> {
    const isTauriEnv =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    const data = JSON.stringify({
      count,
      version: this.config.currentVersion,
      dbInstallId: this.databaseInstallId?.() ?? null,
      updatedAt: new Date().toISOString(),
    });

    if (isTauriEnv) {
      await invoke('write_sentinel_command', {
        key: SENTINEL_KEY,
        data,
      });
    } else {
      sessionStorage.setItem(SENTINEL_KEY, data);
    }
  }
}
