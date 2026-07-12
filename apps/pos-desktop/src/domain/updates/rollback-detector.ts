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

  constructor(private readonly config: RollbackDetectorConfig) {
    this.onRollbackRecommended = config.onRollbackRecommended;
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

      if (isTauriEnv) {
        const sentinelData = await invoke<{
          count: number;
          version: string;
        }>('read_sentinel_command', {
          key: SENTINEL_KEY,
        });
        startupCount = sentinelData.count;
        lastVersion = sentinelData.version;
      } else {
        // Dev fallback: use sessionStorage
        const raw = sessionStorage.getItem(SENTINEL_KEY);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as { count: number; version: string };
            startupCount = parsed.count;
            lastVersion = parsed.version;
          } catch {
            // Ignore parse errors
          }
        }
        lastVersion = lastVersion || this.config.currentVersion;
      }

      // 2. If this is a different version from the sentinel, reset counter
      if (lastVersion && lastVersion !== this.config.currentVersion) {
        // The version changed (new update installed) — this is the first run.
        // Increment the counter (this call itself IS a startup attempt).
        startupCount = 1;
        await this.writeSentinel(startupCount);

        if (isTauriEnv) {
          // Set a one-shot timer to clear the sentinel after 60 seconds.
          // This runs in the JS context; if the app crashes, the timer never fires.
          setTimeout(async () => {
            try {
              await this.markStartupSuccess();
            } catch {
              // Ignore cleanup errors.
            }
          }, STABILITY_WINDOW_MS);
        }

        return {
          needsRollback: false,
          reason: null,
        };
      }

      // 3. Same version — increment crash counter
      startupCount += 1;
      await this.writeSentinel(startupCount);

      // If this is the first startup of an existing version, set stability timer
      if (startupCount <= 1 && isTauriEnv) {
        setTimeout(async () => {
          try {
            await this.markStartupSuccess();
          } catch {
            // Ignore cleanup errors.
          }
        }, STABILITY_WINDOW_MS);
      }

      // 4. Check if we've exceeded the crash threshold
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

  private async writeSentinel(count: number): Promise<void> {
    const isTauriEnv =
      typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

    const data = JSON.stringify({
      count,
      version: this.config.currentVersion,
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
