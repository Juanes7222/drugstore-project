/**
 * Pull-based refresh scheduler for local read-only caches.
 *
 * Runs `pullCatalog()` and `pullLots()` on a fixed interval while the app
 * is online, so the local database stays reasonably current with the server
 * without draining battery or bandwidth on every tick.
 *
 * Both catalog and lot sync share the same timer to keep overhead low;
 * they already skip when offline, so a single check at the top is enough.
 * The interval is intentionally coarse (5 minutes by default) — stock
 * levels that need to be fresher than that are fetched on demand by the
 * caller (e.g. `consumeStockForSale` reads the local table directly).
 *
 * ## Usage
 * Call `start()` once during app initialisation.  The scheduler will
 * immediately fire a full sync and then repeat on the configured interval.
 * Call `stop()` during teardown to clear the timer.
 */

import { PrismaClient } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import type {
  CatalogSyncService,
  CatalogSyncConfig,
} from '../catalog/catalog-sync.service';
import { createCatalogSyncService } from '../catalog/catalog-sync.service';
import type {
  LotSyncService,
  LotSyncConfig,
} from '../inventory-lots/lot-sync.service';
import { createLotSyncService } from '../inventory-lots/lot-sync.service';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SyncSchedulerConfig {
  prisma: PrismaClient;
  catalog: CatalogSyncConfig;
  lots: LotSyncConfig;
  /** Refresh interval in milliseconds (default: 5 minutes). */
  intervalMs?: number;
}

export const createSyncScheduler = (
  config: SyncSchedulerConfig,
): SyncScheduler => {
  return new SyncScheduler(config);
};

// ---------------------------------------------------------------------------
// Scheduler
// ---------------------------------------------------------------------------

export class SyncScheduler {
  private readonly catalogSync: CatalogSyncService;
  private readonly lotSync: LotSyncService;
  private readonly intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(config: SyncSchedulerConfig) {
    this.catalogSync = createCatalogSyncService(config.prisma, config.catalog);
    this.lotSync = createLotSyncService(config.prisma, config.lots);
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the periodic refresh cycle.
   *
   * Fires a full sync immediately, then repeats on `intervalMs`.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start(): void {
    if (this.timerId !== null) return;

    // Fire immediately (no delay before first tick)
    void this.tick();

    this.timerId = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  /**
   * Stop the periodic refresh cycle.
   * Safe to call when already stopped — no-op.
   */
  stop(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Run a single sync cycle now, regardless of the interval.
   * Useful when connectivity is restored mid-interval.
   */
  async syncNow(): Promise<void> {
    await this.tick();
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Execute one round of pulls (catalog → lots) when online.
   * Swallows individual errors so a failure in one pull does not
   * prevent the other from running on the same tick.
   */
  private async tick(): Promise<void> {
    if (!isOnline()) return;

    // Catalog first — lots depend on product references being current.
    try {
      await this.catalogSync.pullCatalog();
    } catch {
      // Logged downstream; continue to lot sync regardless.
    }

    try {
      await this.lotSync.pullLots();
    } catch {
      // Logged downstream; continue.
    }
  }
}
