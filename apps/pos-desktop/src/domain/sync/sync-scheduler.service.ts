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
import { dbWriteLock } from '../../infrastructure/write-lock';
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
import { useSyncAuthStatusStore } from './sync-auth-status.store';
import type { InvoiceService } from '../fiscal/invoice.service';
import {
  createTenantConfigSyncService,
  type TenantConfigSyncService,
  type TenantConfigSyncConfig,
} from '../config/config-sync.service';

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
  /** Config for tenant config sync (optional). */
  tenantConfig?: TenantConfigSyncConfig;
  /** Optional auth token for protected endpoints. */
  accessToken?: string;
  /** Refresh interval in milliseconds (default: 5 minutes). */
  intervalMs?: number;
  /** Invoice service for pulling fiscal transmission results. */
  invoiceService?: InvoiceService;
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
  private accessToken?: string;
  private configSync: ConfigSyncService;
  private tenantConfigSync?: TenantConfigSyncService;
  private catalogSync: CatalogSyncService;
  private lotSync: LotSyncService;
  private clientPull: ClientPullService;
  private pushService: SyncPushService;
  private readonly metricsService: SyncMetricsService;
  private readonly backupService: BackupService;
  private readonly invoiceService?: InvoiceService;
  private readonly intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | null = null;

  constructor(config: SyncSchedulerConfig) {
    this.prisma = config.prisma;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.configSync = createConfigSyncService(config.prisma, {
      ...config.config,
      accessToken: config.accessToken ?? config.config.accessToken,
    });
    this.catalogSync = createCatalogSyncService(config.prisma, {
      ...config.catalog,
      accessToken: config.accessToken ?? config.catalog.accessToken,
    });
    this.lotSync = createLotSyncService(config.prisma, {
      ...config.lots,
      accessToken: config.accessToken ?? config.lots.accessToken,
    });
    this.clientPull = createClientPullService(config.prisma, {
      ...config.clients,
      accessToken: config.accessToken ?? config.clients.accessToken,
    });
    this.pushService = createSyncPushService({
      prisma: config.prisma,
      baseUrl: config.baseUrl,
      accessToken: config.accessToken,
    });
    this.metricsService = createSyncMetricsService(config.prisma);
    this.backupService = createBackupService();
    this.invoiceService = config.invoiceService;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;

    if (config.tenantConfig) {
      this.tenantConfigSync = createTenantConfigSyncService({
        ...config.tenantConfig,
        accessToken: config.accessToken ?? config.tenantConfig.accessToken,
      });
    }
  }

  /**
   * Update the access token after the user logs in, so that subsequent sync
   * requests authenticate correctly.  Sub-services are re-created with the
   * new token.
   */
  updateAccessToken(token: string): void {
    this.accessToken = token;
    const baseConfig = { baseUrl: this.baseUrl, accessToken: token };
    this.configSync = createConfigSyncService(this.prisma, baseConfig);
    this.catalogSync = createCatalogSyncService(this.prisma, baseConfig);
    this.lotSync = createLotSyncService(this.prisma, baseConfig);
    this.clientPull = createClientPullService(this.prisma, baseConfig);
    this.pushService = createSyncPushService({
      prisma: this.prisma,
      baseUrl: this.baseUrl,
      accessToken: token,
      invoiceService: this.invoiceService,
    });
    // Also recreate tenant config sync with new token
    this.tenantConfigSync = createTenantConfigSyncService({
      baseUrl: this.baseUrl,
      accessToken: token,
    });
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /**
   * Start the periodic sync cycle.
   *
   * 1. Immediately refreshes the access token if needed (before any sync
   *    operations attempt to use it).
   * 2. Fires a full cycle immediately.
   * 3. Repeats on `intervalMs`.
   *
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start(): void {
    if (this.timerId !== null) return;

    // 1. Ensure the token is valid before any sync operations run.
    //    This is especially important when the session was restored from
    //    local storage with an expired or near-expiry token — waiting
    //    for the next scheduled tick could leave the app without a valid
    //    auth credential for several minutes.
    if (isOnline()) {
      // Fire-and-forget; errors are non-fatal (tick will retry).
      this.refreshAccessToken().catch(() => {
        /* swallow — the per-step error handling in tick() covers this */
      });
    }

    // 2. Fire immediately (no delay before first tick).
    //    tick() also calls refreshAccessToken as its first step, so the
    //    call above is a speculative early refresh — if it succeeded the
    //    tick's own refresh call is a no-op (token is still fresh); if it
    //    failed the tick retries.
    void this.tick();

    // 3. Schedule periodic repeats.
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
  // Write-lock helper — serializes PGlite access with foreground operations
  // (sale confirms) so sync never blocks the POS.
  // -----------------------------------------------------------------------

  /**
   * Execute `fn` while holding the PGlite write lock.
   * Sync steps acquire/release per step (not for the whole cycle) so a
   * foreground sale confirm can interleave between them.
   */
  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    await dbWriteLock.acquire();
    try {
      return await fn();
    } finally {
      dbWriteLock.release();
    }
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  /**
   * Refresh the access token if it is expired or about to expire within the
   * next sync interval.
   *
   * **Primary path:** Tries `POST /auth/refresh` with the current access
   * token (standard refresh).  This works as long as the access token has
   * not yet expired — JwtAuthGuard on the server validates it.
   *
   * **Fallback path:** If the primary path fails (likely because the access
   * token has already expired), this falls back to `POST /auth/token/exchange`
   * using the **offline token** (a long-lived JWT, 14–30 day TTL).  The
   * exchange endpoint validates the offline token directly without requiring
   * a valid access token.
   *
   * If either path succeeds, the Zustand session store is updated and all
   * sub-services are re-created with the new token via `updateAccessToken`.
   * If both fail (e.g., offline token also expired, server unreachable), the
   * existing (expired) token is kept and individual sync requests will get
   * 401 — the per-step try/catch in `tick()` handles that gracefully.
   *
   * @returns `true` if the token was freshly verified (either still valid
   *          or successfully refreshed), `false` if no session exists.
   */
  private async refreshAccessToken(): Promise<boolean> {
    const session = useLocalSessionStore.getState().session;
    if (!session?.refreshToken || !session?.accessToken) {
      useSyncAuthStatusStore.getState().setNoSession();
      return false;
    }

    // Check if the token is still valid for at least one more interval.
    const msUntilExpiry = session.expiresAt.getTime() - Date.now();
    const bufferMs = this.intervalMs * 2; // 2x interval as safety margin
    if (msUntilExpiry > bufferMs) {
      useSyncAuthStatusStore.getState().setFresh();
      return true; // Still fresh
    }

    // ---------------------------------------------------------
    // Path 1: Standard refresh via POST /auth/refresh
    // ---------------------------------------------------------
    try {
      const response = await fetch(`${this.baseUrl}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessToken}`,
        },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          accessToken: string;
          refreshToken: string;
          expiresAt: string;
        };

        // Update the Zustand store so other parts of the app also see the
        // new credentials (e.g., the HTTP client in catalog-service-factory).
        useLocalSessionStore.getState().updateSession({
          accessToken: data.accessToken,
          refreshToken: data.refreshToken,
          expiresAt: new Date(data.expiresAt),
        });

        // Recreate all sub-services with the fresh token.
        this.updateAccessToken(data.accessToken);

        // Publish auth status for the sync health UI.
        useSyncAuthStatusStore.getState().setRefreshed();

        return true;
      } else {
        // Standard refresh rejected — likely 401 (expired token).
        useSyncAuthStatusStore.getState().setFailed(
          `Standard refresh rejected (HTTP ${response.status})`,
        );
      }
    } catch {
      // Network error — fall through to offline token exchange.
      useSyncAuthStatusStore.getState().setFailed(
        'Standard refresh failed (network error) — trying offline exchange',
      );
    }

    // ---------------------------------------------------------
    // Path 2: Fallback — offline token exchange
    // POST /auth/token/exchange with the long-lived offline token.
    // ---------------------------------------------------------
    if (!session.offlineToken) {
      // No offline token available — nothing more we can do.
      return false;
    }

    try {
      const exchangeResponse = await fetch(
        `${this.baseUrl}/auth/token/exchange`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offlineToken: session.offlineToken }),
        },
      );

      if (!exchangeResponse.ok) {
        // Offline token also rejected — user must re-login manually.
        useSyncAuthStatusStore.getState().setFailed(
          `Offline token exchange rejected (HTTP ${exchangeResponse.status})`,
        );
        return false;
      }

      type ExchangeResponse = {
        accessToken: string;
        refreshToken: string;
        expiresAt: string;
        offlineToken: { token: string; expiresAt: string };
      };
      const exchangeData =
        (await exchangeResponse.json()) as ExchangeResponse;

      // Update the Zustand store with fresh credentials (includes new
      // offline token for future exchanges).
      useLocalSessionStore.getState().updateSession({
        accessToken: exchangeData.accessToken,
        refreshToken: exchangeData.refreshToken,
        expiresAt: new Date(exchangeData.expiresAt),
        offlineToken: exchangeData.offlineToken.token,
      });

      // Recreate all sub-services with the fresh access token.
      this.updateAccessToken(exchangeData.accessToken);

      // Publish auth status for the sync health UI.
      useSyncAuthStatusStore.getState().setExchanged();

      return true;
    } catch {
      // Network error or server unreachable — the per-step try/catch in
      // tick() handles 401 responses for individual requests.
      useSyncAuthStatusStore.getState().setFailed(
        'Offline token exchange failed (network error)',
      );
      return false;
    }
  }

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

    // Refresh the access token if needed before running any sync operations.
    // If the token could not be refreshed (offline, server error) the
    // existing token is kept — individual requests will fail with 401 and
    // be swallowed by their per-step try/catch.
    try {
      await this.refreshAccessToken();
    } catch {
      // Non-fatal; continue with the current token.
    }

    // 0. Configuration first — business rules (discounts, payment methods,
    //    sync defaults) must be current before anything else runs.
    try {
      await this.withLock(() => this.configSync.pullConfiguration());
    } catch {
      // Logged downstream; continue to push regardless.
    }

    // 0.5. Tenant config — the effective config drives field requirements
    //       and workflow decisions for downstream operations.
    if (this.tenantConfigSync) {
      try {
        await this.withLock(() => this.tenantConfigSync!.pullTenantConfig());
      } catch {
        // Swallow — the store keeps the last known config.
      }
    }

    // 1. Push pending local operations (delegated to SyncPushService)
    try {
      await this.withLock(() => this.pushService.pushPending());
    } catch {
      // Logged downstream; continue to pulls regardless.
    }

    // 2. Catalog first — lots depend on product references being current.
    try {
      await this.withLock(() => this.catalogSync.pullCatalog());
    } catch {
      // Logged downstream; continue.
    }

    // 3. Lot sync
    try {
      await this.withLock(() => this.lotSync.pullLots());
    } catch {
      // Logged downstream; continue.
    }

    // 4. Client pull
    try {
      await this.withLock(() => this.clientPull.pullClients());
    } catch {
      // Logged downstream; continue.
    }

    // 5. Pull invoice transmission results (only if the invoice service is available)
    if (this.invoiceService) {
      try {
        const applied = await this.withLock(() =>
          this.invoiceService!.pullAndApplyResults(
            this.baseUrl,
            this.accessToken,
          ),
        );
        if (applied > 0) {
          console.info(`[SyncScheduler] Applied ${applied} invoice transmission result(s).`);
        }
      } catch {
        // Logged downstream; continue.
      }
    }

    // 7. Periodic background backup (offline-safe, runs regardless of online status)
    try {
      await this.withLock(async () => {
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
      });
    } catch {
      // Backups are advisory on the sync cycle; failures are surfaced on the
      // recovery page and via backup-health metrics.
    }

    // 8. Emit metrics (always computed locally — offline-safe)
    try {
      const counts = await this.withLock(() => this.metricsService.getQueueCounts());
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