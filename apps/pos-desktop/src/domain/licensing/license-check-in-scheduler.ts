/**
 * License check-in scheduler for the POS desktop app.
 *
 * Runs periodic check-ins piggybacking on network connectivity.
 * The check-in refreshes the local license token and updates the
 * subscription status from the server.
 *
 * If the server returns LOCKED or REVOKED status, the local store
 * is updated immediately so the LicenseGuard can enforce soft lock
 * on the next write operation.
 *
 * The scheduler is independent of the main SyncScheduler but runs
 * on the same tick cycle. It is started from the app initialization.
 */
import { LicenseStatus } from '@pharmacy/shared-types';
import { useLicenseStore } from './license.store';
import type { LicenseService } from './license.service';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface LicenseCheckInSchedulerConfig {
  licenseService: LicenseService;
  /** Interval in milliseconds (default: 24 hours). */
  intervalMs?: number;
}

export const createLicenseCheckInScheduler = (
  config: LicenseCheckInSchedulerConfig,
): LicenseCheckInScheduler => {
  return new LicenseCheckInScheduler(config);
};

export class LicenseCheckInScheduler {
  private readonly licenseService: LicenseService;
  private readonly intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(config: LicenseCheckInSchedulerConfig) {
    this.licenseService = config.licenseService;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  /**
   * Start the periodic check-in cycle.
   * Fires a check-in immediately, then repeats on the interval.
   * Safe to call multiple times.
   */
  start(): void {
    if (this.timerId !== null) return;

    // Check license status first
    const state = useLicenseStore.getState();
    if (state.status === LicenseStatus.UNACTIVATED || state.status === LicenseStatus.LOCKED) {
      return; // No point checking in if not activated or already locked
    }

    // Fire immediately
    void this.tick();
    this.timerId = setInterval(() => void this.tick(), this.intervalMs);
  }

  /**
   * Stop the periodic check-in cycle.
   */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Force a check-in cycle immediately.
   */
  async checkInNow(): Promise<void> {
    await this.tick();
  }

  private async tick(): Promise<void> {
    try {
      const result = await this.licenseService.checkIn();
      
      if (result) {
        // Check if we need to update the license status based on the
        // check-in response
        if (result.licenseStatus === 'LOCKED' || result.licenseStatus === 'REVOKED') {
          if (result.licenseStatus === 'REVOKED') {
            useLicenseStore.getState().setRevoked();
          } else {
            useLicenseStore.getState().setLocked();
          }
        }
        
        console.info(
          JSON.stringify({
            event: 'license-check-in-complete',
            status: result.licenseStatus,
            expiresAt: result.expiresAt,
            daysUntilGracePeriodEnd: result.daysUntilGracePeriodEnd,
          }),
        );
      }
    } catch (error) {
      // Silently fail — the local token continues to work until it expires
      console.warn(
        `License check-in failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
