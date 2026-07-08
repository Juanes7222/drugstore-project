/**
 * Bidirectional sync scheduler for the POS desktop app.
 *
 * Runs a full sync cycle on a fixed interval while the app is online:
 *
 * 1. **Pull configuration** — fetch payment methods, discount limits,
 *    alert thresholds, and sync defaults from the server; hydrate the
 *    local Prisma PaymentMethod table and the persistent Zustand store.
 * 2. **Push** — send pending (or retryable) SyncQueue rows to the
 *    server's `POST /sync/batch` endpoint.
 * 3. **Pull catalog** — refresh product, category, and form data.
 * 4. **Pull lots** — refresh inventory lot data (depends on product refs).
 * 5. **Pull clients** — download recently-updated clients from the server.
 *
 * Configuration is pulled *first* so that downstream steps (catalog, lots,
 * clients) operate under the latest business rules.
 *
 * Each step catches its own errors so a single failure does not block the
 * rest of the cycle.  The interval is intentionally coarse (5 minutes by
 * default) — the local database is already the single writer authority for
 * offline operations, so sub-minute freshness is not required.
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

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const PUSH_BATCH_LIMIT = 10;
const MAX_RETRY_ATTEMPTS = 10;

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

    // 1. Push pending local operations to the server
    try {
      await this.pushPendingOperations();
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
  }

  /**
   * Push pending local operations from the SyncQueue to the server.
   *
   * Reads up to `PUSH_BATCH_LIMIT` rows that are either:
   * - `PENDING` (not yet sent), or
   * - `FAILED` with `retryCount < MAX_RETRY_ATTEMPTS` and
   *   `nextRetryAt <= now` (ready for retry).
   *
   * On success (HTTP 2xx), marks entries as `COMPLETED` in the local
   * queue for audit-trail purposes.
   * On HTTP 4xx, marks entries as `FAILED` permanently.
   * On HTTP 5xx or network error, increments `retryCount` and schedules
   * a retry with exponential backoff; entries that exhaust
   * `MAX_RETRY_ATTEMPTS` are permanently marked `FAILED`.
   *
   * Uses the default `fetch` API with an auth header when configured.
   */
  private async pushPendingOperations(): Promise<void> {
    const now = new Date();
    const pending = await this.prisma.syncQueue.findMany({
      where: {
        OR: [
          { status: 'PENDING' },
          {
            status: 'FAILED',
            retryCount: { lt: MAX_RETRY_ATTEMPTS },
            nextRetryAt: { lte: now },
          },
        ],
      },
      orderBy: { clientSequence: 'asc' },
      take: PUSH_BATCH_LIMIT,
    });

    if (pending.length === 0) return;

    const operations = pending.map((entry) => ({
      operationType: entry.operationType,
      operationUuid: entry.operationUuid,
      payload: JSON.parse(entry.payload) as Record<string, unknown>,
      payloadHash: entry.payloadHash,
      sourceCreatedAt: entry.sourceCreatedAt.toISOString(),
      clientSequence: Number(entry.clientSequence),
    }));

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const entryIds = pending.map((e) => e.id);

    // Send batch to server
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/sync/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify(operations),
      });
    } catch {
      // Network error (DNS, connection refused, timeout) — schedule retry
      await this.markPushRetry(
        entryIds,
        'Network error during sync push',
      );
      return;
    }

    if (response.ok) {
      // Server accepted the batch — mark as COMPLETED, keeping the queue
      // entry as an audit trail of what was synchronised.
      await this.prisma.syncQueue.updateMany({
        where: { id: { in: entryIds } },
        data: { status: 'COMPLETED' },
      });
      return;
    }

    const body = await response.text().catch(() => '');
    const statusCode = response.status;

    if (statusCode >= 400 && statusCode < 500) {
      // Client error (bad request, conflict, etc.) — permanent failure
      await this.prisma.syncQueue.updateMany({
        where: { id: { in: entryIds } },
        data: {
          status: 'FAILED',
          lastErrorMessage:
            `Server rejected batch (${statusCode}): ${body || response.statusText}`.slice(
              0,
              2000,
            ),
        },
      });
    } else {
      // Server error (5xx) — retry with backoff
      await this.markPushRetry(
        entryIds,
        `Server error (${statusCode}): ${body || response.statusText}`,
      );
    }
  }

  /**
   * Increment retry count and set next retry timestamp for a set of entries.
   * If an entry has reached `MAX_RETRY_ATTEMPTS`, it is permanently marked
   * FAILED with a descriptive error.
   *
   * Each entry is updated individually inside a transaction because
   * `retryCount` values differ across rows.
   */
  private async markPushRetry(
    entryIds: string[],
    errorMessage?: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const id of entryIds) {
        const entry = await tx.syncQueue.findUnique({ where: { id } });
        if (!entry) continue;

        const newRetryCount = entry.retryCount + 1;

        const updateData: Record<string, unknown> = {
          retryCount: newRetryCount,
          nextRetryAt: new Date(
            Date.now() + computeNextRetryDelay(newRetryCount),
          ),
        };

        if (newRetryCount >= MAX_RETRY_ATTEMPTS) {
          updateData.status = 'FAILED';
          updateData.lastErrorMessage =
            'Exceeded maximum retry attempts';
        } else if (errorMessage) {
          updateData.lastErrorMessage = errorMessage;
        }

        await tx.syncQueue.update({
          where: { id },
          data: updateData,
        });
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute the next retry delay in milliseconds using exponential backoff.
 *
 * | Retry count (post-increment) | Wait  |
 * |---|---|
 * | 1 | 30 seconds |
 * | 2 | 2 minutes  |
 * | 3 | 5 minutes  |
 * | 4 | 10 minutes |
 * | 5+ | 30 minutes (capped) |
 */
function computeNextRetryDelay(retryCount: number): number {
  const delays: Record<number, number> = {
    1: 30_000,
    2: 120_000,
    3: 300_000,
    4: 600_000,
  };
  return delays[retryCount] ?? 1_800_000;
}
