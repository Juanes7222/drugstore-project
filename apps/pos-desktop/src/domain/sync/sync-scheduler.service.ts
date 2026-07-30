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
import { setPushTrigger } from './sync-queue-notifier';
import type { InvoiceService } from '../fiscal/invoice.service';
import type { LocalAuditWriter } from '../audit/local-audit-writer.service';
import type { ProductService } from '../catalog/product.service';
import {
  createTenantConfigSyncService,
  type TenantConfigSyncService,
  type TenantConfigSyncConfig,
} from '../config/config-sync.service';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Reconnect burst schedule.
 *
 * After an offline → online transition the scheduler runs a denser
 * push cadence for ~2 minutes before settling back into the regular
 * 5-minute interval. Two phases:
 *
 * - 6 ticks at 10 s (60 s total) — drains any small backlog that
 *   accumulated during a short network blip.
 * - 2 ticks at 30 s (60 s total) — handles larger backlogs without
 *   hammering the server with a hot loop.
 *
 * Each burst tick runs the unsynced-products scanner before
 * `pushPending()` so product creations land before any sales of those
 * products. The burst is cancelled if the workstation goes offline
 * again before it completes — we re-arm on the next online event.
 */
const BURST_FAST_TICKS = 6;
const BURST_FAST_INTERVAL_MS = 10_000;
const BURST_SLOW_TICKS = 2;
const BURST_SLOW_INTERVAL_MS = 30_000;

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
  /** Local audit event writer (optional). */
  auditWriter?: LocalAuditWriter;
  /**
   * Product service — used by the reconnect burst to enqueue
   * unsynced local products before the regular push begins, so that
   * sales of those products (which the sales-pos service now blocks
   * until `serverId IS NOT NULL`) become sellable as soon as the
   * burst completes.  If omitted, the burst still runs — it just
   * won't reconcile orphan products.
   */
  productService?: ProductService;
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
  private readonly auditWriter?: LocalAuditWriter;
  private readonly productService?: ProductService;
  private readonly intervalMs: number;
  private timerId: ReturnType<typeof setInterval> | null = null;
  /** Reconnect-burst timer + remaining-tick counter.  Null when no burst is active. */
  private burstTimerId: ReturnType<typeof setTimeout> | null = null;
  private burstTicksRemaining: number = 0;
  private burstPhase: 'fast' | 'slow' | null = null;
  /** Tracks previous online state so `tick()` can detect transitions as a fallback. */
  private wasOnline: boolean = false;
  /** Bound handler for `window.online` so `stop()` can detach the same reference. */
  private readonly handleOnlineEvent: () => void;

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
      auditWriter: config.auditWriter,
    });
    this.metricsService = createSyncMetricsService(config.prisma);
    this.backupService = createBackupService();
    this.invoiceService = config.invoiceService;
    this.auditWriter = config.auditWriter;
    this.productService = config.productService;
    this.intervalMs = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.wasOnline = isOnline();
    this.handleOnlineEvent = () => this.onOnlineEvent();

    if (config.tenantConfig) {
      this.tenantConfigSync = createTenantConfigSyncService({
        ...config.tenantConfig,
        accessToken: config.accessToken ?? config.tenantConfig.accessToken,
      });
    }

    // Register the auto-push trigger so notifyPendingEntry() calls from domain
    // services immediately push the new SyncQueue row instead of waiting for
    // the next 5-minute sync cycle.
    setPushTrigger(() => this.triggerPush());
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
      auditWriter: this.auditWriter,
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
   * 4. Subscribes to the browser's `online` event so the first push
   *    after an offline window happens immediately instead of waiting
   *    up to `intervalMs` for the next regular tick. The `online`
   *    listener also arms the reconnect-burst schedule (denser push
   *    cadence for ~2 minutes after reconnect).
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

    // 4. Subscribe to browser `online` events. The handler is stored
    //    as a class field so `stop()` can detach the same reference;
    //    `addEventListener` deduplicates identical (function, capture)
    //    pairs, but using a stored reference makes the intent obvious
    //    and survives refactors that move the handler body.
    if (
      typeof window !== 'undefined' &&
      typeof window.addEventListener === 'function'
    ) {
      window.addEventListener('online', this.handleOnlineEvent);
    }
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
    if (this.burstTimerId !== null) {
      clearTimeout(this.burstTimerId);
      this.burstTimerId = null;
    }
    this.burstTicksRemaining = 0;
    this.burstPhase = null;
    if (
      typeof window !== 'undefined' &&
      typeof window.removeEventListener === 'function'
    ) {
      window.removeEventListener('online', this.handleOnlineEvent);
    }
  }

  /**
   * Run a single sync cycle now, regardless of the interval.
   * Useful when connectivity is restored mid-interval.
   */
  async syncNow(): Promise<void> {
    await this.tick();
  }

  /**
   * Trigger an immediate push of pending SyncQueue entries.
   *
   * Called by `notifyPendingEntry()` (via the registered callback) after a
   * domain service creates a new PENDING SyncQueue row and commits the
   * transaction.  This fires a push immediately instead of waiting for
   * the next 5-minute scheduler tick.
   *
   * Refreshes the access token first so the push does not use a stale/
   * expired token — the regular `tick()` already does this, but the
   * immediate-push path must too, otherwise a sale persisted when the
   * token was near expiry will fail with 401 on the very first push.
   *
   * Fire-and-forget — errors are logged internally by `pushPending()`.
   * No-op when offline (the scheduler's tick will eventually push when
   * connectivity returns).
   */
  triggerPush(): void {
    if (!isOnline()) return;

    void this.withLock(async () => {
      await this.refreshAccessToken();
      await this.pushService.pushPending();
    }).catch(() => {
      /* pushPending handles its own errors */
    });
  }

  /**
   * Handle the browser's `online` event.
   *
   * Three things happen on the offline → online transition:
   *
   * 1. An immediate `pushPending()` fires so a single-entry backlog
   *    drains without waiting for the burst timer.
   * 2. Every FAILED SyncQueue entry has its `nextRetryAt` pushed to
   *    the current instant, so the very next `pushPending()` call
   *    (the one from step 1, then each burst tick) picks them up
   *    instead of waiting on their stale exponential-backoff timer.
   * 3. The reconnect burst is (re-)armed. If a burst is already
   *    running the new arm replaces it — the user just flapped, and
   *    we want to honour the latest reconnect rather than running a
   *    half-finished schedule.
   */
  private onOnlineEvent(): void {
    // The `online` event also fires on the very first render in some
    // browsers (Chromium fires one when the webview loads even if the
    // network is already up). Guard against the spurious initial
    // event by checking the previous state — only act on a real
    // transition offline → online.
    const online = isOnline();
    if (this.wasOnline) {
      // Already online when the event arrived. Nothing to do; the
      // regular tick and the auto-push trigger already cover steady-
      // state traffic.
      return;
    }
    this.wasOnline = online;

    // 1. Refresh token then immediate push (fire-and-forget).
    //    Refreshing first ensures the push doesn't fail with 401 when the
    //    access token expired during the offline window.
    void this.withLock(async () => {
      await this.refreshAccessToken();
      await this.pushService.pushPending();
    }).catch(() => {
      /* pushPending handles its own errors */
    });

    // 2. Reset FAILED entries' `nextRetryAt` so they re-enter the
    //    push pipeline on the very next push. This is the single
    //    change that turns "wait up to 30 minutes for the next
    //    exponential-backoff window" into "drained within ~10
    //    seconds". A push failure during the burst will rewrite
    //    `nextRetryAt` again via `recordBatchFailure`; the reset
    //    only affects entries that were waiting on a stale backoff.
    void this.resetFailedRetryTimers();

    // 3. Arm the burst.
    this.armBurst();
  }

  /**
   * Set `nextRetryAt` to the current instant on every FAILED
   * SyncQueue row whose retry budget is not exhausted. Best-effort:
   * if the write fails the regular push path will eventually pick
   * the entries up at their original backoff time.
   */
  private async resetFailedRetryTimers(): Promise<void> {
    try {
      const now = new Date();
      await this.prisma.syncQueue.updateMany({
        where: {
          status: 'FAILED',
          retryCount: { lt: 10 },
        },
        data: { nextRetryAt: now },
      });
    } catch (err) {
      console.warn(
        '[SyncScheduler] Failed to reset FAILED nextRetryAt on reconnect:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Arm the reconnect-burst schedule. The burst is a `setTimeout`
   * chain (not `setInterval`) because the cadence changes between
   * phases — fast at 10 s for 6 ticks, then slow at 30 s for 2 ticks.
   *
   * Idempotent: calling while a burst is already running cancels
   * the old chain and starts fresh, so flapping connectivity doesn't
   * leave half-completed bursts running indefinitely.
   */
  private armBurst(): void {
    if (this.burstTimerId !== null) {
      clearTimeout(this.burstTimerId);
      this.burstTimerId = null;
    }
    this.burstPhase = 'fast';
    this.burstTicksRemaining = BURST_FAST_TICKS;
    this.scheduleNextBurstTick();
  }

  /**
   * Cancel an in-flight burst. Called from the regular `tick()` when
   * the previous-online tracking detects that we have gone offline
   * between burst ticks.
   */
  private cancelBurst(): void {
    if (this.burstTimerId !== null) {
      clearTimeout(this.burstTimerId);
      this.burstTimerId = null;
    }
    this.burstTicksRemaining = 0;
    this.burstPhase = null;
  }

  private scheduleNextBurstTick(): void {
    if (this.burstTicksRemaining <= 0) {
      this.burstTimerId = null;
      this.burstPhase = null;
      return;
    }
    const interval =
      this.burstPhase === 'fast'
        ? BURST_FAST_INTERVAL_MS
        : BURST_SLOW_INTERVAL_MS;
    this.burstTimerId = setTimeout(() => {
      this.burstTimerId = null;
      void this.runBurstTick();
    }, interval);
  }

  /**
   * One burst tick: enqueue any unsynced products, then push, then
   * decrement the counter and re-arm the next tick (or end the
   * burst if we've run out).
   */
  private async runBurstTick(): Promise<void> {
    if (this.burstTicksRemaining <= 0) return;

    // If the workstation went offline between schedule and fire,
    // abandon the burst — we don't want to do pointless work and
    // we'll re-arm on the next online event.
    if (!isOnline()) {
      this.cancelBurst();
      return;
    }

    // Reconcile orphan products before pushing sales-of-them, so the
    // server's SALE_CONFIRMATION validator finds the referenced
    // products. Failures here are non-fatal; the push step still
    // runs and the orphan scanner will be retried on the next
    // reconnect.
    if (this.productService) {
      try {
        await this.productService.enqueueUnsyncedProducts();
      } catch (err) {
        console.warn(
          '[SyncScheduler] enqueueUnsyncedProducts failed during burst:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    try {
      await this.withLock(() => this.pushService.pushPending());
    } catch {
      // Per-step error handling inside pushPending covers logging.
    }

    this.burstTicksRemaining -= 1;
    if (this.burstTicksRemaining === 0) {
      // Phase boundary: fast → slow, then slow → end.
      if (this.burstPhase === 'fast') {
        this.burstPhase = 'slow';
        this.burstTicksRemaining = BURST_SLOW_TICKS;
      } else {
        this.burstPhase = null;
        this.burstTimerId = null;
        return;
      }
    }
    this.scheduleNextBurstTick();
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
    // Local-only sessions (no accessToken) have no expiry — skip check.
    if (!session.expiresAt) return false;
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
    // Fallback transition detection: the `online` browser event is the
    // primary trigger for the reconnect burst, but it can be missed
    // (webview starts up offline, the OS fires no event when WiFi
    // returns, etc.). The regular tick therefore compares the current
    // online state against the previous one and arms the burst
    // itself when it sees a fresh transition. This is idempotent with
    // the `online` event handler — `onOnlineEvent` already updated
    // `wasOnline` and armed the burst, so the fallback no-ops on a
    // real transition.
    const online = isOnline();
    if (online && !this.wasOnline) {
      this.wasOnline = true;
      this.armBurst();
    } else if (!online && this.wasOnline) {
      this.wasOnline = false;
      this.cancelBurst();
    }

    if (!online) return;

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

    // 4. Client classifications — must be pulled BEFORE clients so the
    //    FK from Client.classificationId to ClientClassification resolves.
    try {
      await this.withLock(() => this.clientPull.pullClassifications());
    } catch {
      // Logged downstream; continue.
    }

    // 5. Client pull
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
          const [pendingCount, failedCount, permanentFailureCount, discardedCount, maxSeqRow] =
            await Promise.all([
              this.prisma.syncQueue.count({ where: { status: 'PENDING' } }),
              this.prisma.syncQueue.count({ where: { status: 'FAILED' } }),
              this.prisma.syncQueue.count({ where: { status: 'PERMANENT_FAILURE' } }),
              this.prisma.syncQueue.count({ where: { status: 'DISCARDED' } }),
              this.prisma.syncQueue.aggregate({ _max: { clientSequence: true } }),
            ]);
          const session = useLocalSessionStore.getState().session;
          await this.backupService.createBackup({
            reason: 'PERIODIC',
            workstationId: session?.workstationId ?? 'unknown',
            dbSchemaVersion: 1,
            pendingCount,
            failedCount,
            permanentFailureCount,
            discardedCount,
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