import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { SyncStatus } from '@pharmacy/database';
import { DomainException } from '@/common/exceptions/domain.exception';
import { SyncOperationDispatcherService } from '../sync-operation-dispatcher.service';
import type { SyncQueueEntry } from '../entities/sync-queue-entry.entity';
import { CashShiftNotOpenForWorkstationException } from '../../sales-pos/exceptions/cash-shift-not-open-for-workstation.exception';

/**
 * Fixed delay between retries for FAILED entries, in seconds.
 * This phase uses a fixed delay rather than exponential backoff; the latter
 * is a valid refinement for a later iteration, not a correctness requirement now.
 */
const RETRY_FIXED_DELAY_SECONDS = 60;

/**
 * Maximum retry attempts before a FAILED entry is abandoned.
 * Matches the POS side's MAX_RETRY_ATTEMPTS in sync-push.service.ts.
 */
const MAX_RETRY_ATTEMPTS = 10;

/** Operation types that the cron job replays. */
const SUPPORTED_TYPES: SyncQueueEntry['operationType'][] = [
  'SALE_CONFIRMATION',
  'SHIFT_CLOSURE',
  'SHIFT_OPEN',
  'CLIENT_CREATION',
  'INVENTORY_ADJUSTMENT',
  'INVOICE_ADJUSTMENT',
  'PRODUCT_CREATION',
  'PRODUCT_UPDATE',
  'PURCHASE_ORDER_CONFIRMATION',
  'PURCHASE_RECEPTION_CONFIRMATION',
  'SUPPLIER_RETURN_CONFIRMATION',
  'AUDIT_LOG_BATCH',
];

@Injectable()
export class SyncProcessingJob {
  private readonly logger = new Logger(SyncProcessingJob.name);
  private processing = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SyncOperationDispatcherService) private readonly dispatcher: SyncOperationDispatcherService,
    @Inject(TenantContextService) private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * Picks up PENDING and retryable FAILED entries of supported types.
   * Unsupported types (FISCAL_DOCUMENT_SYNC, PRESCRIPTION_REGISTRATION,
   * RESOLUTION_ALLOCATION) are never selected.
   *
   * Each entry is marked PROCESSING before dispatch so overlapping cron
   * runs (which can occur when processing takes >30s) will not pick up
   * the same entry twice — the fetch query excludes PROCESSING rows.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async processPendingOperations(): Promise<void> {
    if (this.processing) {
      this.logger.warn('SyncProcessingJob already running — skipping overlapping tick');
      return;
    }
    this.processing = true;
    const startedAt = Date.now();
    try {
      // The cron tick has no request context, and SyncQueue rows are
      // RLS-scoped — iterate tenant by tenant inside withTenant.
      const subscriptions = await this.prisma.subscription.findMany({
        select: { id: true },
      });

      for (const subscription of subscriptions) {
        const entries = await this.prisma.withTenant(subscription.id, () => this.fetchSupportedEntries());
        if (entries.length > 0) {
          this.logger.log(`SyncProcessingJob tick: ${entries.length} entries for subscription ${subscription.id}`);
        }
        for (const entry of entries) {
          const entryStart = Date.now();
          this.logger.log(`SyncProcessingJob start ${entry.id} ${entry.operationType} ${entry.operationUuid} retry=${entry.retryCount}`);
          try {
            await this.prisma.withTenant(subscription.id, () =>
              this.withTimeout(this.processEntry(entry), 25_000, `entry ${entry.id} timeout`),
            );
          } catch (entryError) {
            this.logger.error(`SyncProcessingJob entry ${entry.id} failed with timeout/error: ${entryError instanceof Error ? entryError.message : String(entryError)}`);
            try {
              await this.prisma.withTenant(subscription.id, () => this.markFailed(entry, entryError));
            } catch {}
          }
          this.logger.log(`SyncProcessingJob done ${entry.id} in ${Date.now() - entryStart}ms`);
          if (Date.now() - startedAt > 25_000) {
            this.logger.warn('SyncProcessingJob tick exceeded 25s — yielding to next cron');
            break;
          }
        }
      }
    } finally {
      this.processing = false;
      this.logger.log(`SyncProcessingJob tick finished in ${Date.now() - startedAt}ms`);
    }
  }

  private withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    // Preserve ALS context — the timer callback must not lose the tenant store.
    // Using Promise.race with a timer created inside the current ALS context
    // keeps both branches bound to the same store (unlike a detached new Promise
    // executor that can orphan the tx binding).
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer!));
  }

  /** Queries for supported entries that are ready to process. */
  private async fetchSupportedEntries(): Promise<SyncQueueEntry[]> {
    // Explicit subscription filter: withTenant sets RLS context but if RLS
    // is misconfigured or the table lacks a policy the entry would leak
    // to every tenant iteration, causing the duplicate WARN seen in logs
    // (same operationUuid processed once per subscription).
    const subscriptionId = this.tenantContext.getSubscriptionId();
    return this.prisma.syncQueue.findMany({
      where: {
        subscriptionId,
        operationType: { in: SUPPORTED_TYPES },
        status: { notIn: [SyncStatus.COMPLETED, SyncStatus.PROCESSING, SyncStatus.PERMANENT_FAILURE, SyncStatus.DISCARDED] },
        retryCount: { lt: MAX_RETRY_ATTEMPTS },
        OR: [
          { status: SyncStatus.PENDING },
          { status: SyncStatus.FAILED, nextRetryAt: { lte: new Date() } },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      take: 20,
    }) as Promise<SyncQueueEntry[]>;
  }

  /**
   * Dispatches a single entry and updates its status to COMPLETED.
   *
   * The PROCESSING claim is taken with a conditional updateMany so two
   * concurrent processors (this cron and the batch endpoint's immediate
   * dispatch) can never work the same entry — the loser observes a zero
   * count and skips.
   *
   * Each entry's claim + dispatch + COMPLETED update runs inside a nested
   * savepoint (prisma.$transaction on the same connection via the tenant-
   * aware proxy + Prisma 7.8 adapter-pg). Any DB error in one entry aborts
   * only that savepoint, so the outer withTenant transaction and the next
   * entry's queries remain healthy (fixes 25P02 "current transaction is
   * aborted" after e.g. AUDIT_LOG_BATCH).
   */
  private async processEntry(entry: SyncQueueEntry): Promise<void> {
    const subId = this.tenantContext.getSubscriptionId();
    try {
      await this.prisma.$transaction(async (tx) => {
        // Ensure RLS context inside this transaction — the outer withTenant
        // SET LOCAL is not visible here when this $transaction is routed to
        // a new pooled connection (proxy fallback when ALS tx is null after
        // withTimeout's Promise wrapping). Setting it explicitly makes the
        // claim work regardless of whether this is a savepoint or a new tx.
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${subId}, true)`;
        const claimed = await tx.syncQueue.updateMany({
          where: {
            id: entry.id,
            subscriptionId: subId,
            status: { notIn: [SyncStatus.PROCESSING, SyncStatus.COMPLETED, SyncStatus.PERMANENT_FAILURE, SyncStatus.DISCARDED] },
          },
          data: { status: SyncStatus.PROCESSING },
        });
        if (claimed.count === 0) {
          // Fallback: try without status filter to diagnose RLS vs status
          const exists = await tx.syncQueue.findUnique({ where: { id: entry.id }, select: { status: true, subscriptionId: true } });
          this.logger.warn(`SyncProcessingJob claim failed for ${entry.id} ${entry.operationType} sub=${subId} status=${entry.status} exists=${JSON.stringify(exists)} - another processor won or RLS mismatch`);
          return; // Another processor won the claim
        }
        this.logger.log(`SyncProcessingJob claimed ${entry.id} for dispatch`);

        const result = await this.dispatcher.dispatch(entry);

        // Clear any previous error message from a prior failed attempt —
        // a successful retry should not show stale error context. The
        // dispatcher's entityId / entityInternalCode are stamped here too
        // so a *_CREATION retried after the immediate-dispatch path
        // failed still surfaces the server-assigned ids in the eventual
        // ALREADY_ACCEPTED response on a subsequent push.
        const updated = await tx.syncQueue.update({
          where: { id: entry.id },
          data: {
            status: SyncStatus.COMPLETED,
            processedAt: new Date(),
            lastErrorMessage: null,
            entityId: result.entityId ?? null,
            entityInternalCode: result.entityInternalCode ?? null,
          },
        });
        this.logger.log(`SyncProcessingJob completed ${entry.id} -> COMPLETED`);
      });
    } catch (error: unknown) {
      // CashShiftNotOpenForWorkstation remains potentially transient during
      // a replay burst under the GLOBAL shift model: salesService.create
      // opens a nested interactive transaction on its own connection, which
      // cannot see this dispatcher's still-uncommitted shift bootstrap
      // (adoption or legacy upsert). The next retry runs on a fresh
      // connection where the committed shift — global or adopted — is
      // visible, so treat it as retriable instead of permanently failing.
      if (error instanceof CashShiftNotOpenForWorkstationException) {
        await this.markFailed(entry, error);
        return;
      }
      // Other DomainException subclasses (ProductNotFoundException, etc.)
      // are non-transient — the referenced entity genuinely does not exist
      // on the server and retrying will never succeed. Mark as permanent
      // failure immediately instead of burning 10 retries with 60s delays.
      if (error instanceof DomainException) {
        await this.markPermanentFailure(entry, error);
        return;
      }
      await this.markFailed(entry, error);
    }
  }

  /** Marks an entry as PERMANENT_FAILURE immediately — no more retries. Savepoint-isolated so a failed update does not poison the outer withTenant tx. */
  private async markPermanentFailure(entry: SyncQueueEntry, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const subId = this.tenantContext.hasTenant() ? this.tenantContext.getSubscriptionId() : (entry as any).subscriptionId;

    try {
      await this.prisma.$transaction(async (tx) => {
        if (subId) await tx.$executeRaw`SELECT set_config('app.current_tenant', ${subId}, true)`;
        await tx.syncQueue.update({
          where: { id: entry.id },
          data: {
            status: SyncStatus.PERMANENT_FAILURE,
            retryCount: (entry.retryCount ?? 0) + 1,
            lastErrorMessage: `Permanent failure — no retry: ${errorMessage}`,
            nextRetryAt: null,
          },
        });
      });
    } catch (updateError: unknown) {
      this.logger.warn(
        `Failed to mark sync operation ${entry.id} as PERMANENT_FAILURE: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
      );
      return;
    }

    this.logger.warn(
      `Sync operation ${entry.id} (${entry.operationType}) permanently failed: ${errorMessage}`,
    );
  }

  /** Marks an entry as FAILED, increments retry count, schedules next retry. Savepoint-isolated so a failed update does not poison the outer withTenant tx. */
  private async markFailed(entry: SyncQueueEntry, error: unknown): Promise<void> {
    const retryCount = (entry.retryCount ?? 0) + 1;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const subId = this.tenantContext.hasTenant() ? this.tenantContext.getSubscriptionId() : (entry as any).subscriptionId;

    const exhausted = retryCount >= MAX_RETRY_ATTEMPTS;
    const data: Record<string, unknown> = {
      status: exhausted ? SyncStatus.PERMANENT_FAILURE : SyncStatus.FAILED,
      retryCount,
      lastErrorMessage: exhausted
        ? `Exceeded max retry attempts (${MAX_RETRY_ATTEMPTS}): ${errorMessage}`
        : errorMessage,
      nextRetryAt: exhausted
        ? null
        : new Date(Date.now() + RETRY_FIXED_DELAY_SECONDS * 1000),
    };

    try {
      await this.prisma.$transaction(async (tx) => {
        if (subId) await tx.$executeRaw`SELECT set_config('app.current_tenant', ${subId}, true)`;
        await tx.syncQueue.update({
          where: { id: entry.id },
          data,
        });
      });
    } catch (updateError: unknown) {
      this.logger.warn(
        `Failed to mark sync operation ${entry.id} as FAILED: ${updateError instanceof Error ? updateError.message : String(updateError)}`,
      );
      return;
    }

    this.logger.warn(
      `Sync operation ${entry.id} (${entry.operationType}) failed: ${errorMessage}` +
        (exhausted ? ` — no more retries (max ${MAX_RETRY_ATTEMPTS})` : ` — retry ${retryCount}/${MAX_RETRY_ATTEMPTS}`),
    );
  }
}
