/**
 * Bidirectional sync scheduler for the POS desktop app.
 *
 * Runs a full sync cycle on a fixed interval while the app is online:
 *
 * 1. **Pull configuration** — fetch payment methods, discount limits,
 *    alert thresholds, and sync defaults from the server; hydrate the
 *    local Prisma PaymentMethod table and the persistent Zustand store.
 * 2. **Push** — send pending (or retryable) SyncQueue rows to the
 *    server's `POST /sync/batch` endpoint (delegated to SyncPushService).
 * 3. **Pull catalog** — refresh product, category, and form data.
 * 4. **Pull lots** — refresh inventory lot data (depends on product refs).
 * 5. **Pull clients** — download recently-updated clients from the server.
 *
 * Configuration is pulled *first* so that downstream steps (catalog, lots,
 * clients) operate under the latest business rules.
 *
 * Each step catches its own errors so a single failure does not block the
 * rest of the cycle.  After the cycle, metrics are emitted as a structured
 * log line for operator visibility.
 *
 * ## Usage
 * Call `start()` once during app initialisation.  The scheduler will
 * immediately fire a full sync and then repeat on the configured interval.
 * Call `stop()` during teardown to clear the timer.
 */

import { PrismaClient } from '@pharmacy/database/local';
import { isOnline } from '../../common/is-online';
import { useLocalSessionStore } from '../auth/local-session.store';
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
import type {
  ClientPullService,
  ClientPullConfig,
} from '../clients/client-pull.service';
import { createClientPullService } from '../clients/client-pull.service';
import type {
  ConfigSyncService,
  ConfigSyncConfig,
} from '../configuration/config-sync.service';
import { createConfigSyncService } from '../configuration/config-sync.service';
import type { SyncPushService } from './sync-push.service';
import { createSyncPushService } from './sync-push.service';
import type { SyncMetricsService } from './sync-metrics.service';
import { createSyncMetricsService } from './sync-metrics.service';
import { createBackupService, type BackupService } from '../backup/backup.service';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface SyncSchedulerConfig {
  prisma: PrismaClient;
  /** Server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
  config: ConfigSyncConfig;
  catalog: CatalogSyncConfig;
  lots: LotSyncConfig;
  clients: ClientPullConfig;
  /** Optional auth token for protected endpoints. */
  accessToken?: string;
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
  private readonly prisma: PrismaClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly configSync: ConfigSyncService;
  private readonly catalogSync: CatalogSyncService;
  private readonly lotSync: LotSyncService;
  private readonly clientPull: ClientPullService;
  private readonly pushService: SyncPushService;
  private readonly metricsService: SyncMetricsService;
  private readonly backupService: BackupService;
  private readonly intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(config: SyncSchedulerConfig) {
    this.prisma = config.prisma;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.configSync = createConfigSyncService(config.prisma, config.config);
    this.catalogSync = createCatalogSyncService(config.prisma, config.catalog);
    this.lotSync = createLotSyncService(config.prisma, config.lots);
    this.clientPull = createClientPullService(config.prisma, config.clients);
    this.pushService = createSyncPushService({
      prisma: config.prisma,
      baseUrl: config.baseUrl,
      accessToken: config.accessToken,
    });
    this.metricsService = createSyncMetricsService(config.prisma);
    this.backupService = createBackupService();
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the periodic sync cycle.
   *
   * Fires a full cycle immediately, then repeats on `intervalMs`.
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
   * Stop the periodic sync cycle.
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
   * Execute one full sync cycle: config → push → catalog → lots → clients.
   *
   * Configuration is pulled first so that payment methods, discount limits,
   * and sync engine defaults are current before any other operation runs.
   *
   * Each step swallows its own errors so a failure in one does not prevent
   * the others from running on the same tick.
   *
   * After the cycle, emits a structured log line with queue counts.
   * Metrics are computed regardless of online status (offline-safe).
   */
  private async tick(): Promise<void> {
    if (!isOnline()) return;

    // 0. Configuration first — business rules (discounts, payment methods,
    //    sync defaults) must be current before anything else runs.
    try {
      await this.configSync.pullConfiguration();
    } catch {
      // Logged downstream; continue to push regardless.
    }

    // 1. Push pending local operations (delegated to SyncPushService)
    try {
      await this.pushService.pushPending();
    } catch {
      // Logged downstream; continue to pulls regardless.
    }

    // 2. Catalog first — lots depend on product references being current.
    try {
      await this.catalogSync.pullCatalog();
    } catch {
      // Logged downstream; continue.
    }

    // 3. Lot sync
    try {
      await this.lotSync.pullLots();
    } catch {
      // Logged downstream; continue.
    }

    // 4. Client pull
    try {
      await this.clientPull.pullClients();
    } catch {
      // Logged downstream; continue.
    }

    // 5. Periodic background backup (offline-safe, runs regardless of online status)
    try {
      const summary = await this.metricsService.getBackupSummary();
      if (this.backupService.shouldRunPeriodicBackup(summary.lastBackupAt)) {
        const [pendingCount, failedCount, maxSeqRow] = await Promise.all([
          this.prisma.syncQueue.count({ where: { status: 'PENDING' } }),
          this.prisma.syncQueue.count({ where: { status: 'FAILED' } }),
          this.prisma.syncQueue.aggregate({ _max: { clientSequence: true } }),
        ]);
        const session = useLocalSessionStore.getState().session;
        await this.backupService.createBackup({
          reason: 'PERIODIC',
          workstationId: session?.workstationId ?? 'unknown',
          dbSchemaVersion: 1,
          pendingCount,
          failedCount,
          maxClientSequence: Number(maxSeqRow._max.clientSequence ?? 0n),
        });
      }
    } catch {
      // Backups are advisory on the sync cycle; failures are surfaced on the
      // recovery page and via backup-health metrics.
    }

    // 6. Emit metrics (always computed locally — offline-safe)
    try {
      const counts = await this.metricsService.getQueueCounts();
      // Structured log line for operator visibility
      console.info(
        JSON.stringify({
          event: 'sync-cycle-complete',
          pending: counts.pending,
          stalePending: counts.stalePending,
          failed: counts.failed,
          permanentFailure: counts.permanentFailure,
          completed24h: counts.completed24h,
        }),
      );
    } catch {
      // Metrics are advisory; do not break the cycle.
    }
  }
}