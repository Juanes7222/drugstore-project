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
 * 5.6 **Pull user identities** — refresh the login-grid mirror
 *    (`GET /users/login-identities`) into the avatar-grid cache and PGlite
 *    identity rows.
 * 6. **Pull purchases** — suppliers → purchase orders → receptions → supplier returns (FK order).
 * 7. **Pull sales history** — confirmed sales + items/payments so a new device hydrates.
 * 8. **Pull invoices** — fiscal documents for those sales (Facturación) so detail view has invoices.
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
import { createSecureStorage } from '../../infrastructure/secure-storage';
import {
  useLocalSessionStore,
  type LocalSession,
} from '../auth/local-session.store';
import { HttpStatusException } from '../auth/auth-http-client';
import { decodeOfflineToken } from '../auth/offline';
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
  OpenShiftPullService,
} from '../cash-shift/open-shift-pull.service';
import { createOpenShiftPullService } from '../cash-shift/open-shift-pull.service';
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
import { setPushTrigger, removePushTrigger } from './sync-queue-notifier';
import type { InvoiceService } from '../fiscal/invoice.service';
import type { LocalAuditWriter } from '../audit/local-audit-writer.service';
import type { ProductService } from '../catalog/product.service';
import {
  createTenantConfigSyncService,
  type TenantConfigSyncService,
  type TenantConfigSyncConfig,
} from '../config/config-sync.service';
import type {
  SupplierSyncService,
  SupplierSyncConfig,
} from '../purchases/supplier-sync.service';
import { createSupplierSyncService } from '../purchases/supplier-sync.service';
import type {
  PurchaseOrderSyncService,
  PurchaseOrderSyncConfig,
} from '../purchases/purchase-order-sync.service';
import { createPurchaseOrderSyncService } from '../purchases/purchase-order-sync.service';
import type {
  PurchaseReceptionSyncService,
  PurchaseReceptionSyncConfig,
} from '../purchases/purchase-reception-sync.service';
import { createPurchaseReceptionSyncService } from '../purchases/purchase-reception-sync.service';
import type {
  SupplierReturnSyncService,
  SupplierReturnSyncConfig,
} from '../purchases/supplier-return-sync.service';
import { createSupplierReturnSyncService } from '../purchases/supplier-return-sync.service';
import type {
  SalesSyncService,
  SalesSyncConfig,
} from '../sales-pos/sales-sync.service';
import { createSalesSyncService } from '../sales-pos/sales-sync.service';
import type {
  InvoiceSyncService,
  InvoiceSyncConfig,
} from '../fiscal/invoice-sync.service';
import { createInvoiceSyncService } from '../fiscal/invoice-sync.service';
import type {
  InvoiceAdjustmentSyncService,
  InvoiceAdjustmentSyncConfig,
} from '../fiscal/invoice-adjustment-sync.service';
import { createInvoiceAdjustmentSyncService } from '../fiscal/invoice-adjustment-sync.service';
import { createAuditSyncService, type AuditSyncService } from '../audit/audit-sync.service';
import {
  createUserPullService,
  type UserPullConfig,
  type UserPullService,
} from '../auth/user-pull.service';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/** When the outbox still holds pending work, drain faster than the 5-minute default. */
const DRAIN_INTERVAL_MS = 15_000;

/**
 * Safely parse the session's `expiresAt` regardless of whether it was
 * deserialized as a Date object or an ISO string (Zustand persist / JSON).
 * Returns `null` when the value is missing or unparseable.
 */
function getExpiryMs(value: unknown): number | null {
  if (!value) return null;
  if (value instanceof Date) {
    const t = value.getTime();
    return Number.isNaN(t) ? null : t;
  }
  const t = new Date(value as string | number).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Compact, single-line description of a swallowed sync-step error so the
 * console.warn calls in `tick()` stay greppable without dumping full stack
 * traces on every retry cycle.
 */
function describeSyncError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

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
  /** User identities for the login grid (optional, default = same baseUrl + token) */
  users?: UserPullConfig;
  /** Supplier / purchases / sales hydration (optional, default = same baseUrl + token) */
  suppliers?: SupplierSyncConfig;
  purchaseOrders?: PurchaseOrderSyncConfig;
  purchaseReceptions?: PurchaseReceptionSyncConfig;
  supplierReturns?: SupplierReturnSyncConfig;
  sales?: SalesSyncConfig;
  invoices?: InvoiceSyncConfig;
  invoiceAdjustments?: InvoiceAdjustmentSyncConfig;
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
  /**
   * Mirror of the offline token the push service was built with. The push
   * service snapshots the token at construction; the scheduler keeps its
   * own copy so the auth-readiness gate (skip pushes known to be
   * unauthenticated) can tell whether `X-Offline-Token` is actually
   * being sent without reaching into the service.
   */
  private offlineToken?: string;
  /**
   * Pulls the server answered with 403 for the current session's role.
   * Skipping them keeps the sync cycle quiet instead of logging the same
   * authorization failure every interval; updateAccessToken() clears the
   * set on re-login because a different user may be allowed to pull.
   */
  private readonly pullSuppressed = new Set<string>();
  private configSync: ConfigSyncService;
  private tenantConfigSync?: TenantConfigSyncService;
  private catalogSync: CatalogSyncService;
  private lotSync: LotSyncService;
  private clientPull: ClientPullService;
  private userPull: UserPullService;
  private openShiftPull: OpenShiftPullService;
  private supplierSync: SupplierSyncService;
  private purchaseOrderSync: PurchaseOrderSyncService;
  private purchaseReceptionSync: PurchaseReceptionSyncService;
  private supplierReturnSync: SupplierReturnSyncService;
  private salesSync: SalesSyncService;
  private invoiceSync: InvoiceSyncService;
  private invoiceAdjustmentSync: InvoiceAdjustmentSyncService;
  private pushService: SyncPushService;
  private readonly metricsService: SyncMetricsService;
  private readonly backupService: BackupService;
  private readonly invoiceService?: InvoiceService;
  private readonly auditWriter?: LocalAuditWriter;
  private readonly productService?: ProductService;
  private auditSync: AuditSyncService;
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
  private pushInFlight = false;
  private pushQueued = false;
  /** Adaptive drain timer — fires every 15s while the outbox still holds pending work. */
  private drainTimerId: ReturnType<typeof setTimeout> | null = null;

  constructor(config: SyncSchedulerConfig) {
    this.prisma = config.prisma;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.offlineToken =
      useLocalSessionStore.getState().session?.offlineToken ?? undefined;
    const syncBase = { baseUrl: config.baseUrl, accessToken: config.accessToken, offlineToken: this.offlineToken };
    this.configSync = createConfigSyncService(config.prisma, {
      ...syncBase,
      ...config.config,
      accessToken: config.accessToken ?? config.config.accessToken,
      offlineToken: this.offlineToken ?? (config.config as any)?.offlineToken,
    });
    this.catalogSync = createCatalogSyncService(config.prisma, {
      ...syncBase,
      ...config.catalog,
      accessToken: config.accessToken ?? config.catalog.accessToken,
      offlineToken: this.offlineToken ?? (config.catalog as any)?.offlineToken,
    });
    this.lotSync = createLotSyncService(config.prisma, {
      ...syncBase,
      ...config.lots,
      accessToken: config.accessToken ?? config.lots.accessToken,
      offlineToken: this.offlineToken ?? (config.lots as any)?.offlineToken,
    });
    this.clientPull = createClientPullService(config.prisma, {
      ...syncBase,
      ...config.clients,
      accessToken: config.accessToken ?? config.clients.accessToken,
      offlineToken: this.offlineToken ?? (config.clients as any)?.offlineToken,
    });
    this.openShiftPull = createOpenShiftPullService(
      config.prisma,
      { ...syncBase, accessToken: config.accessToken },
      this.readWorkstationContext(),
    );
    this.userPull = createUserPullService({
      ...syncBase,
      ...config.users,
      accessToken: config.accessToken ?? config.users?.accessToken,
      offlineToken: this.offlineToken ?? config.users?.offlineToken,
    });
    const purchasesBase = syncBase;
    this.supplierSync = createSupplierSyncService(config.prisma, {
      ...purchasesBase,
      ...config.suppliers,
      accessToken: config.accessToken ?? config.suppliers?.accessToken,
      offlineToken: this.offlineToken ?? config.suppliers?.offlineToken,
    });
    this.purchaseOrderSync = createPurchaseOrderSyncService(config.prisma, {
      ...purchasesBase,
      ...config.purchaseOrders,
      accessToken: config.accessToken ?? config.purchaseOrders?.accessToken,
      offlineToken: this.offlineToken ?? config.purchaseOrders?.offlineToken,
    });
    this.purchaseReceptionSync = createPurchaseReceptionSyncService(config.prisma, {
      ...purchasesBase,
      ...config.purchaseReceptions,
      accessToken: config.accessToken ?? config.purchaseReceptions?.accessToken,
      offlineToken: this.offlineToken ?? config.purchaseReceptions?.offlineToken,
    });
    this.supplierReturnSync = createSupplierReturnSyncService(config.prisma, {
      ...purchasesBase,
      ...config.supplierReturns,
      accessToken: config.accessToken ?? config.supplierReturns?.accessToken,
      offlineToken: this.offlineToken ?? config.supplierReturns?.offlineToken,
    });
    this.salesSync = createSalesSyncService(config.prisma, {
      ...purchasesBase,
      ...config.sales,
      accessToken: config.accessToken ?? config.sales?.accessToken,
      offlineToken: this.offlineToken ?? config.sales?.offlineToken,
    });
    this.invoiceSync = createInvoiceSyncService(config.prisma, {
      ...purchasesBase,
      ...config.invoices,
      accessToken: config.accessToken ?? config.invoices?.accessToken,
      offlineToken: this.offlineToken ?? config.invoices?.offlineToken,
    });
    this.invoiceAdjustmentSync = createInvoiceAdjustmentSyncService(config.prisma, {
      ...purchasesBase,
      ...config.invoiceAdjustments,
      accessToken: config.accessToken ?? config.invoiceAdjustments?.accessToken,
      offlineToken: this.offlineToken ?? config.invoiceAdjustments?.offlineToken,
    });
    this.pushService = createSyncPushService({
      prisma: config.prisma,
      baseUrl: config.baseUrl,
      accessToken: config.accessToken,
      offlineToken: this.offlineToken,
      auditWriter: config.auditWriter,
    });
    this.auditSync = createAuditSyncService({
      prisma: config.prisma,
      workstationId: useLocalSessionStore.getState().session?.workstationId,
      userId: useLocalSessionStore.getState().session?.userId,
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
    // the next 5-minute sync cycle. Kept as a field so stop() can unregister
    // it: without this, a discarded scheduler (React StrictMode double-mount
    // in dev, or any re-creation) keeps firing orphan pushes on every notify.
    setPushTrigger(this.autoPushTrigger);
  }

  /**
   * Bound auto-push trigger registered with the SyncQueue notifier.
   * A field (not an inline arrow) so stop() unregisters this exact
   * reference.
   */
  private readonly autoPushTrigger = (): void => {
    this.triggerPush();
  };

  /**
   * Update the access token after the user logs in, so that subsequent sync
   * requests authenticate correctly.  Sub-services are re-created with the
   * new token.
   */
  updateAccessToken(token: string): void {
    this.accessToken = token;
    // A fresh login may carry different roles — re-enable pulls that were
    // suppressed because the previous session was forbidden to run them.
    this.pullSuppressed.clear();
    this.offlineToken =
      useLocalSessionStore.getState().session?.offlineToken ?? undefined;
    const baseConfig = { baseUrl: this.baseUrl, accessToken: token, offlineToken: this.offlineToken };
    this.configSync = createConfigSyncService(this.prisma, baseConfig);
    this.catalogSync = createCatalogSyncService(this.prisma, baseConfig);
    this.lotSync = createLotSyncService(this.prisma, baseConfig);
    this.clientPull = createClientPullService(this.prisma, baseConfig);
    this.userPull = createUserPullService(baseConfig);
    this.openShiftPull = createOpenShiftPullService(
      this.prisma,
      { baseUrl: this.baseUrl, accessToken: token },
      this.readWorkstationContext(),
    );
    this.supplierSync = createSupplierSyncService(this.prisma, baseConfig);
    this.purchaseOrderSync = createPurchaseOrderSyncService(this.prisma, baseConfig);
    this.purchaseReceptionSync = createPurchaseReceptionSyncService(this.prisma, baseConfig);
    this.supplierReturnSync = createSupplierReturnSyncService(this.prisma, baseConfig);
    this.salesSync = createSalesSyncService(this.prisma, baseConfig);
    this.invoiceSync = createInvoiceSyncService(this.prisma, baseConfig);
    this.invoiceAdjustmentSync = createInvoiceAdjustmentSyncService(this.prisma, baseConfig);
    this.pushService = createSyncPushService({
      prisma: this.prisma,
      baseUrl: this.baseUrl,
      accessToken: token,
      offlineToken: this.offlineToken,
      invoiceService: this.invoiceService,
      auditWriter: this.auditWriter,
    });
    this.auditSync = createAuditSyncService({
      prisma: this.prisma,
      workstationId: useLocalSessionStore.getState().session?.workstationId,
      userId: useLocalSessionStore.getState().session?.userId,
    });
    // Also recreate tenant config sync with new token
    this.tenantConfigSync = createTenantConfigSyncService({
      baseUrl: this.baseUrl,
      accessToken: token,
    });
  }

  /**
   * Workstation identity for the open-shift pull's conflict heuristic.
   * Read at construction/re-creation time — a fresh login always carries a
   * session, so the value is real by then; 'unknown' before it only makes
   * the pull conservative (never supersedes an unattributed local shift).
   */
  private readWorkstationContext(): { workstationId: string } {
    return {
      workstationId:
        useLocalSessionStore.getState().session?.workstationId ?? 'unknown',
    };
  }

  /**
   * Whether the error is the server refusing this session's role (403).
   * Falls back to message matching because some pull services wrap the
   * original HttpStatusException into a domain exception carrying the
   * status in the message text.
   */
  private isForbidden(err: unknown): boolean {
    if (err instanceof HttpStatusException) return err.status === 403;
    const message = describeSyncError(err);
    return /\b403\b|\bForbidden\b/i.test(message);
  }

  /**
   * Stop attempting a pull the server forbids for this role, logging once.
   * The suppression lives until the next login (updateAccessToken clears
   * it) — retrying every cycle would only repeat the same authorization
   * failure against an endpoint that will not change its answer.
   */
  private suppressPull(name: string): void {
    if (this.pullSuppressed.has(name)) return;
    this.pullSuppressed.add(name);
    console.info(
      `[SyncScheduler] ${name} pull forbidden for this role — suppressed until next login`,
    );
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
    // Unregister first: a stopped scheduler must never fire orphan pushes
    // from notifier calls (StrictMode double-mount leaves the first
    // instance discarded but otherwise alive).
    removePushTrigger(this.autoPushTrigger);
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
    if (this.burstTimerId !== null) {
      clearTimeout(this.burstTimerId);
      this.burstTimerId = null;
    }
    if (this.drainTimerId !== null) {
      clearTimeout(this.drainTimerId);
      this.drainTimerId = null;
    }
    this.burstTicksRemaining = 0;
    this.burstPhase = null;
    this.pushInFlight = false;
    this.pushQueued = false;
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
   *
   * Coalescing: rapid successive calls (e.g. a batch of sales) collapse
   * into a single in-flight push; one extra run is queued if new work
   * arrived while the first was still executing.
   */
  triggerPush(): void {
    if (!isOnline()) return;
    if (dbWriteLock.isBackgroundPaused()) return;
    if (this.pushInFlight) {
      this.pushQueued = true;
      return;
    }
    this.pushInFlight = true;

    void (async () => {
      try {
        const refreshed = await this.refreshAccessToken();
        if (refreshed || this.offlineToken !== undefined) {
          await this.runPush();
        }
        // Re-evaluate drain after an immediate push — if work remains,
        // ensure the adaptive timer keeps polling every 15s.
        void this.scheduleDrainIfNeeded();
      } finally {
        this.pushInFlight = false;
        if (this.pushQueued) {
          this.pushQueued = false;
          // Defer one extra run to coalesce any burst that arrived mid-flight.
          setTimeout(() => this.triggerPush(), 300);
        }
      }
    })().catch(() => {
      this.pushInFlight = false;
      /* runPush handles its own errors */
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

    // A shift close pauses the background around its backup-heavy critical
    // section. During that window the immediate push and the retry-timer
    // reset would only queue behind it, so skip both — the burst ticks and
    // the regular cycle will catch up. The burst is still armed below (timers
    // only, no DB work).
    if (!dbWriteLock.isBackgroundPaused()) {
      // 1. Refresh token then immediate push (fire-and-forget).
      //    Refreshing first ensures the push doesn't fail with 401 when the
      //    access token expired during the offline window. The refresh and
      //    the push's network POST run unlocked (network + store only);
      //    only the push's DB writes take the lock.
      void (async () => {
        const refreshed = await this.refreshAccessToken();
        // Same auth-readiness gate as triggerPush: skip only when the
        // refresh failed and there is no offline token to authenticate
        // with. The burst below catches up once credentials exist.
        if (refreshed || this.offlineToken !== undefined) {
          await this.runPush();
        }
      })().catch(() => {
        /* runPush handles its own errors */
      });

      // 2. Reset FAILED entries' `nextRetryAt` so they re-enter the
      //    push pipeline on the very next push. This is the single
      //    change that turns "wait up to 30 minutes for the next
      //    exponential-backoff window" into "drained within ~10
      //    seconds". A push failure during the burst will rewrite
      //    `nextRetryAt` again via `recordBatchFailure`; the reset
      //    only affects entries that were waiting on a stale backoff.
      void this.resetFailedRetryTimers();
    }

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

    // Shift-close pause: the close holds the lock through a full DB backup.
    // Skip this tick's push rather than queue behind it; the tick is still
    // consumed so the burst cadence stays on schedule.
    if (dbWriteLock.isBackgroundPaused()) {
      this.advanceBurstTick();
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
      const refreshed = await this.refreshAccessToken();
      // Auth-readiness gate (same as triggerPush/onOnlineEvent): don't
      // hammer the server with pushes that are known to be
      // unauthenticated — the regular tick recovers once credentials do.
      if (refreshed || this.offlineToken !== undefined) {
        await this.runPush();
      }
    } catch {
      // Per-step error handling inside runPush covers logging.
    }

    this.advanceBurstTick();
  }

  /**
   * Consume one burst tick and re-arm the next one (or finish the burst
   * when the phase budget is exhausted). Shared by the normal path and the
   * shift-close pause so a skipped tick still advances the cadence.
   */
  private advanceBurstTick(): void {
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

  /**
   * Enqueue any `LocalAuditLog` rows that have not yet been added to
   * `SyncQueue`. Best-effort — a failure here does not block the push.
   */
  private async enqueueAuditLogs(): Promise<void> {
    try {
      await this.withLock(() => this.auditSync.enqueueUnsynced());
    } catch (err) {
      console.warn('[SyncScheduler] audit enqueue failed:', describeSyncError(err));
    }
  }

  /**
   * Run one push cycle: prepare (DB read) → send (network) → apply (DB
   * write under the lock). The HTTP POST never holds the lock, so a slow
   * server round-trip can't block a foreground sale confirm or shift close.
   */
  private async runPush(): Promise<void> {
    // Ensure audit rows are in the queue before we pick the batch
    await this.enqueueAuditLogs();
    const prepared = await this.pushService.preparePush();
    if (prepared.entries.length === 0) return;
    const transport = await this.pushService.sendBatch(prepared);
    await this.withLock(() =>
      this.pushService.applyPushResult(prepared, transport, new Date()),
    );
  }

  /**
   * Whether any SyncQueue rows still need cloud delivery (PENDING or
   * retryable FAILED). Used to decide if the adaptive drain timer must
   * keep polling every 15s instead of the 5-minute default.
   */
  private async hasPendingEntries(): Promise<boolean> {
    try {
      const count = await this.prisma.syncQueue.count({
        where: {
          status: { in: ['PENDING', 'FAILED'] as const },
        },
      });
      return count > 0;
    } catch {
      return false;
    }
  }

  /**
   * Adaptive drain: if work remains after a cycle, ensure a 15s timer
   * keeps re-running `tick()` until the outbox empties. Otherwise cancel
   * it and let the regular 5-minute interval carry the steady state.
   * Best-effort — a DB error here never breaks the cycle.
   */
  private async scheduleDrainIfNeeded(): Promise<void> {
    try {
      const hasPending = await this.hasPendingEntries();
      if (hasPending) {
        if (this.drainTimerId !== null) return;
        this.drainTimerId = setTimeout(() => {
          this.drainTimerId = null;
          void this.tick().then(() => {
            void this.scheduleDrainIfNeeded();
          });
        }, DRAIN_INTERVAL_MS);
      } else {
        if (this.drainTimerId !== null) {
          clearTimeout(this.drainTimerId);
          this.drainTimerId = null;
        }
      }
    } catch {
      // Advisory — ignore.
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
    console.debug('[SyncScheduler] refreshAccessToken check', {
      hasRefresh: !!session?.refreshToken,
      hasAccess: !!session?.accessToken,
      hasOffline: !!session?.offlineToken,
      hasExpiresAt: !!session?.expiresAt,
      expiresAtType: typeof session?.expiresAt,
      expiryMs: getExpiryMs(session?.expiresAt as unknown),
      offlineTokenCached: !!this.offlineToken,
    });
    if (!session?.refreshToken || !session?.accessToken) {
      useSyncAuthStatusStore.getState().setNoSession();
      console.warn('[SyncScheduler] refresh skip: missing refresh/access token', { hasOffline: !!session?.offlineToken, hasOfflineCached: !!this.offlineToken });
      return false;
    }

    // Check if the token is still valid for at least one more interval.
    // `expiresAt` may be a Date or an ISO string depending on how the
    // session was deserialized (Zustand persist / JSON). Parse robustly.
    const expiryMs = getExpiryMs(session.expiresAt);
    if (expiryMs === null) {
      // No usable expiry — treat as needing refresh (don't silently fail
      // as the old `session.expiresAt.getTime()` TypeError did).
      // Fall through to the refresh attempt below.
    } else {
      const msUntilExpiry = expiryMs - Date.now();
      const bufferMs = this.intervalMs * 2; // 2x interval as safety margin
      if (msUntilExpiry > bufferMs) {
        useSyncAuthStatusStore.getState().setFresh();
        // The token is fresh, so updateAccessToken() will not run on this
        // call — but the push service's offline token snapshot may have
        // gone stale without an access-token change. Re-sync it so a new
        // offline token landing in the session still reaches the push.
        this.syncOfflineTokenFromSession();
        return true; // Still fresh
      }
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

        // Fresh credentials — reset FAILED entries' nextRetryAt so the
        // queue drains immediately instead of waiting out stale backoff.
        void this.resetFailedRetryTimers();

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
    let offlineToken = session.offlineToken;
    if (!offlineToken) {
      // The in-memory session may predate offline-token issuance (or have
      // lost it on rotation). The authoritative recovery source is the
      // cached offline token in SecureStorage, written at every online
      // login by OfflineAuthService.updateCachedCredentials.
      offlineToken = await this.recoverCachedOfflineToken(session);
    }
    if (!offlineToken) {
      // No offline token available — nothing more we can do.
      return false;
    }

    try {
      const exchangeResponse = await fetch(
        `${this.baseUrl}/auth/token/exchange`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ offlineToken }),
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

      // The exchange rotates the offline token — keep the SecureStorage
      // cache in sync so the next recovery (and offline logins) use the
      // current token instead of a possibly-revoked one. Best-effort.
      void this.refreshCachedOfflineToken(
        session.userId,
        exchangeData.offlineToken.token,
        exchangeData.offlineToken.expiresAt,
      ).catch(() => {
        /* non-fatal — the session store already carries the fresh token */
      });

      // Recreate all sub-services with the fresh access token.
      this.updateAccessToken(exchangeData.accessToken);

      // Credentials just changed — reset FAILED entries' nextRetryAt so
      // the queue drains immediately instead of waiting out stale backoff
      // (same treatment the reconnect handler applies).
      void this.resetFailedRetryTimers();

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
   * Re-sync the push service's offline token snapshot from the session
   * store when it changed without an access-token change.
   *
   * The push service captures the offline token at construction and is
   * normally rebuilt by `updateAccessToken()` — but that only runs when
   * the access token itself changes. If a flow writes a new offline token
   * into the session while the access token stays the same, the push
   * would keep sending stale headers. Push and purchase/sales pulls consume
   * the offline token, so they are rebuilt here.
   */
  private syncOfflineTokenFromSession(): void {
    const current =
      useLocalSessionStore.getState().session?.offlineToken ?? undefined;
    if (current === this.offlineToken) return;
    this.offlineToken = current;
    const baseConfig = { baseUrl: this.baseUrl, accessToken: this.accessToken, offlineToken: current };
    this.pushService = createSyncPushService({
      prisma: this.prisma,
      baseUrl: this.baseUrl,
      accessToken: this.accessToken,
      offlineToken: current,
      invoiceService: this.invoiceService,
      auditWriter: this.auditWriter,
    });
    this.auditSync = createAuditSyncService({
      prisma: this.prisma,
      workstationId: useLocalSessionStore.getState().session?.workstationId,
      userId: useLocalSessionStore.getState().session?.userId,
    });
    this.userPull = createUserPullService(baseConfig);
    this.supplierSync = createSupplierSyncService(this.prisma, baseConfig);
    this.purchaseOrderSync = createPurchaseOrderSyncService(this.prisma, baseConfig);
    this.purchaseReceptionSync = createPurchaseReceptionSyncService(this.prisma, baseConfig);
    this.supplierReturnSync = createSupplierReturnSyncService(this.prisma, baseConfig);
    this.salesSync = createSalesSyncService(this.prisma, baseConfig);
    this.invoiceSync = createInvoiceSyncService(this.prisma, baseConfig);
    this.invoiceAdjustmentSync = createInvoiceAdjustmentSyncService(this.prisma, baseConfig);
  }

  /**
   * Recover the cached offline token from SecureStorage, if present and
   * not expired.
   *
   * The token is written under `offline_token_{userId}` at every online
   * login by `OfflineAuthService.updateCachedCredentials` and is the
   * authoritative recovery source when the in-memory session predates
   * offline-token issuance. Returns `null` when nothing usable is cached.
   */
  private async recoverCachedOfflineToken(
    session: LocalSession,
  ): Promise<string | null> {
    try {
      const secureStorage = await createSecureStorage();
      if (!(await secureStorage.isAvailable())) return null;
      const token = await secureStorage.getItem(
        `offline_token_${session.userId}`,
      );
      if (!token) return null;
      const claims = decodeOfflineToken(token);
      if (!claims) return null;
      // JWT `exp` is in seconds since epoch.
      if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
      return token;
    } catch {
      // Best-effort recovery — the auth-readiness gate suppresses pushes
      // until credentials become available.
      return null;
    }
  }

  /**
   * Best-effort: keep the cached offline token in SecureStorage current
   * after an exchange rotated it. Mirrors the storage layout used by
   * `OfflineAuthService.updateCachedCredentials`.
   */
  private async refreshCachedOfflineToken(
    userId: string,
    token: string,
    expiresAt: string,
  ): Promise<void> {
    try {
      const secureStorage = await createSecureStorage();
      if (!(await secureStorage.isAvailable())) return;
      await secureStorage.setItem(`offline_token_${userId}`, token);
      await secureStorage.setItem(`offline_token_expiry_${userId}`, expiresAt);
    } catch {
      // Non-fatal — the session store already carries the fresh token.
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

    // Shift-close pause: the close's critical section (a full DB backup) can
    // hold the lock for seconds. Skip the whole cycle instead of queueing
    // step after step behind it — the next scheduled tick resumes normally.
    if (dbWriteLock.isBackgroundPaused()) return;

    // Refresh the access token if needed before running any sync operations.
    // If the token could not be refreshed (offline, server error) the
    // existing token is kept — individual requests would fail with 401 and
    // be swallowed by their per-step try/catch. The boolean result feeds
    // the auth-readiness gate below, which suppresses pushes that are
    // known to be unauthenticated (no verified token, no offline token).
    let authReady = false;
    try {
      authReady = await this.refreshAccessToken();
    } catch {
      // Non-fatal; continue with the current token.
    }

    // 0. Configuration first — business rules (discounts, payment methods,
    //    sync defaults) must be current before anything else runs. The HTTP
    //    fetch runs unlocked; only the local write holds the lock.
    try {
      const payload = await this.configSync.fetchConfiguration();
      await this.withLock(() => this.configSync.applyConfiguration(payload));
    } catch (err) {
      // Swallowed so the rest of the cycle still runs, but never silently —
      // a config pull failing on every tick must be visible in the console.
      console.warn('[SyncScheduler] config pull failed:', describeSyncError(err));
    }

    // 0.5. Tenant config — the effective config drives field requirements
    //       and workflow decisions for downstream operations. Hydrates a
    //       Zustand store only (no PGlite writes) — no lock needed.
    if (this.tenantConfigSync) {
      try {
        await this.tenantConfigSync!.pullTenantConfig();
      } catch {
        // Swallow — the store keeps the last known config.
      }
    }

    // 1. Push pending local operations (delegated to SyncPushService).
    //    The network POST runs unlocked; only the queue/attempt writes
    //    hold the lock. Skipped when auth is known-bad: the refresh
    //    failed AND the push service holds no offline token. An offline
    //    token alone is a valid credential (the server guard accepts
    //    X-Offline-Token without a Bearer header), so pushes still run
    //    when it is present; transient 401s with credentials flow through
    //    the normal retry/backoff path.
    if (authReady || this.offlineToken !== undefined) {
      try {
        await this.runPush();
      } catch {
        // Logged downstream; continue to pulls regardless.
      }
    }

    // 2. Catalog first — lots depend on product references being current.
    if (!this.pullSuppressed.has('catalog')) {
      try {
        const payload = await this.catalogSync.fetchCatalog();
        await this.withLock(() => this.catalogSync.applyCatalog(payload));
      } catch (err) {
        if (this.isForbidden(err)) {
          this.suppressPull('catalog');
        } else {
          // A catalog apply that rolls back (FK/enum mismatch, oversized
          // transaction) must be visible — it is the difference between a POS
          // with products and one selling from an empty mirror forever.
          console.warn('[SyncScheduler] catalog pull failed:', describeSyncError(err));
        }
      }
    }

    // 3. Lot sync — server 26/08 fix: GET /inventory-lots/lots/sync and
    //    legacy GET /inventory-lots/lots now allow CASHIER (previously 403
    //    when the POS ran as cashier). The POS must hydrate the offline
    //    Lot cache for every workstation (ws_principal, ws_secundaria, …)
    //    without requiring an ADMIN token. A 403 here is no longer an
    //    expected role mismatch to suppress permanently — log and retry
    //    next tick so a previously-suppressed workstation recovers without
    //    a fresh ADMIN login.
    try {
      const lots = await this.lotSync.fetchLots();
      await this.withLock(() => this.lotSync.applyLots(lots));
    } catch (err) {
      if (this.isForbidden(err)) {
        console.warn(
          '[SyncScheduler] lot pull forbidden (unexpected after 26/08 CASHIER fix) — will retry next tick:',
          describeSyncError(err),
        );
      } else {
        console.warn('[SyncScheduler] lot pull failed:', describeSyncError(err));
      }
    }

    // 4. Client classifications — must be pulled BEFORE clients so the
    //    FK from Client.classificationId to ClientClassification resolves.
    if (!this.pullSuppressed.has('client-classifications')) {
      try {
        const rows = await this.clientPull.fetchClassifications();
        await this.withLock(() => this.clientPull.applyClassifications(rows));
      } catch (err) {
        if (this.isForbidden(err)) {
          this.suppressPull('client-classifications');
        } else {
          console.warn(
            '[SyncScheduler] client-classification pull failed:',
            describeSyncError(err),
          );
        }
      }
    }

    // 5. Client pull
    if (!this.pullSuppressed.has('clients')) {
      try {
        const clients = await this.clientPull.fetchClients();
        await this.withLock(() => this.clientPull.applyClients(clients));
      } catch (err) {
        if (this.isForbidden(err)) {
          this.suppressPull('clients');
        } else {
          console.warn('[SyncScheduler] client pull failed:', describeSyncError(err));
        }
      }
    }

    // 5.5. Open-shift mirror — the shift is store-wide; another workstation
    //      may have opened it. Adopting the server's OPEN row here lets this
    //      POS sell into the same shift even before its next full restart.
    //      A 404 (no open shift anywhere) is normal, not an error.
    if (!this.pullSuppressed.has('open-shift')) {
      try {
        const row = await this.openShiftPull.fetchOpenShift();
        if (row) {
          const result = await this.withLock(() =>
            this.openShiftPull.applyOpenShift(row),
          );
          if (result.status === 'local-open-conflict') {
            console.warn(
              `[SyncScheduler] open-shift conflict: local ${result.localShiftId} vs server ${result.serverShiftId} — keeping local until its push lands`,
            );
          }
        }
      } catch (err) {
        if (this.isForbidden(err)) {
          this.suppressPull('open-shift');
        } else {
          console.warn('[SyncScheduler] open-shift pull failed:', describeSyncError(err));
        }
      }
    }

    // 5.6 User identities — login-grid mirror (GET /users/login-identities,
    //     reachable by every POS role). Refreshes the avatar-grid cache and
    //     upserts PGlite identity rows; never carries credential material.
    if (!this.pullSuppressed.has('users')) {
      try {
        const rows = await this.userPull.fetchUserIdentities();
        await this.withLock(() => this.userPull.applyUserIdentities(rows));
      } catch (err) {
        if (this.isForbidden(err)) this.suppressPull('users');
        else console.warn('[SyncScheduler] users pull failed:', describeSyncError(err));
      }
    }

    // 6. Purchases hydration — order matters: suppliers first (FK for orders/receptions/returns),
    //    then orders, then receptions, then supplier-returns. Each step fetches without lock
    //    and applies under lock so the PGlite lock is held only for the upsert.
    if (!this.pullSuppressed.has('suppliers')) {
      try {
        const rows = await this.supplierSync.fetchSuppliers();
        await this.withLock(() => this.supplierSync.applySuppliers(rows));
      } catch (err) {
        if (this.isForbidden(err)) this.suppressPull('suppliers');
        else console.warn('[SyncScheduler] suppliers pull failed:', describeSyncError(err));
      }
    }

    if (!this.pullSuppressed.has('purchase-orders')) {
      try {
        const rows = await this.purchaseOrderSync.fetchPurchaseOrders();
        await this.withLock(() => this.purchaseOrderSync.applyPurchaseOrders(rows));
      } catch (err) {
        if (this.isForbidden(err)) this.suppressPull('purchase-orders');
        else console.warn('[SyncScheduler] purchase-orders pull failed:', describeSyncError(err));
      }
    }

    if (!this.pullSuppressed.has('purchase-receptions')) {
      try {
        const rows = await this.purchaseReceptionSync.fetchReceptions();
        await this.withLock(() => this.purchaseReceptionSync.applyReceptions(rows));
      } catch (err) {
        if (this.isForbidden(err)) this.suppressPull('purchase-receptions');
        else console.warn('[SyncScheduler] purchase-receptions pull failed:', describeSyncError(err));
      }
    }

    if (!this.pullSuppressed.has('supplier-returns')) {
      try {
        const rows = await this.supplierReturnSync.fetchSupplierReturns();
        await this.withLock(() => this.supplierReturnSync.applySupplierReturns(rows));
      } catch (err) {
        if (this.isForbidden(err)) this.suppressPull('supplier-returns');
        else console.warn('[SyncScheduler] supplier-returns pull failed:', describeSyncError(err));
      }
    }

    // 6.5 Sales history — hydrates local Sale + items/payments so a new device
    //     sees full history. Must run after clients + suppliers (FK via snapshots)
    //     but does not block purchases.
    if (!this.pullSuppressed.has('sales')) {
      try {
        const rows = await this.salesSync.fetchSales();
        await this.withLock(() => this.salesSync.applySales(rows));
      } catch (err) {
        if (this.isForbidden(err)) this.suppressPull('sales');
        else console.warn('[SyncScheduler] sales pull failed:', describeSyncError(err));
      }
    }

    // 6.6 Invoices — hydrates local Invoice for hydrated sales so Facturación
    //     and sale detail have fiscal documents. Must run after sales (FK saleId).
    if (!this.pullSuppressed.has('invoices')) {
      try {
        const rows = await this.invoiceSync.fetchInvoices();
        await this.withLock(() => this.invoiceSync.applyInvoices(rows));
      } catch (err) {
        if (this.isForbidden(err)) this.suppressPull('invoices');
        else console.warn('[SyncScheduler] invoices pull failed:', describeSyncError(err));
      }
    }

    // 6.7 Invoice adjustments — CLIENT_CHANGE etc so operational view shows corrections cross-workstation.
    //     Must run after invoices (FK invoiceId).
    if (!this.pullSuppressed.has('invoice-adjustments')) {
      try {
        const rows = await this.invoiceAdjustmentSync.fetchAdjustments();
        await this.withLock(() => this.invoiceAdjustmentSync.applyAdjustments(rows));
      } catch (err) {
        if (this.isForbidden(err)) this.suppressPull('invoice-adjustments');
        else console.warn('[SyncScheduler] invoice-adjustments pull failed:', describeSyncError(err));
      }
    }

    // 5. Pull invoice transmission results (only if the invoice service is available)
    if (this.invoiceService) {
      try {
        const results = await this.invoiceService!.fetchInvoiceResults(
          this.baseUrl,
          this.accessToken,
        );
        const applied = results
          ? await this.withLock(() =>
              this.invoiceService!.applyInvoiceResults(results),
            )
          : 0;
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

    // 9. Adaptive drain — if pending/failed rows remain, keep a 15s
    //    re-tick alive until empty; otherwise let the 5-minute interval
    //    handle the idle steady state. Also triggered from triggerPush so
    //    a burst that landed between ticks doesn't wait for the interval.
    void this.scheduleDrainIfNeeded();
  }
}