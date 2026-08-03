import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import { SyncOperationDispatcherService } from '../sync-operation-dispatcher.service';
import type { SyncQueueEntry } from '../entities/sync-queue-entry.entity';

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
  'CLIENT_CREATION',
  'INVENTORY_ADJUSTMENT',
  'INVOICE_ADJUSTMENT',
  'PRODUCT_CREATION',
  'PRODUCT_UPDATE',
  'PURCHASE_ORDER_CONFIRMATION',
  'PURCHASE_RECEPTION_CONFIRMATION',
  'SUPPLIER_RETURN_CONFIRMATION',
];

@Injectable()
export class SyncProcessingJob {
  private readonly logger = new Logger(SyncProcessingJob.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SyncOperationDispatcherService) private readonly dispatcher: SyncOperationDispatcherService,
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
    // The cron tick has no request context, and SyncQueue rows are
    // RLS-scoped — iterate tenant by tenant inside withTenant.
    const subscriptions = await this.prisma.subscription.findMany({
      select: { id: true },
    });

    for (const subscription of subscriptions) {
      await this.prisma.withTenant(subscription.id, async () => {
        const entries = await this.fetchSupportedEntries();
        for (const entry of entries) {
          await this.processEntry(entry);
        }
      });
    }
  }

  /** Queries for supported entries that are ready to process. */
  private async fetchSupportedEntries(): Promise<SyncQueueEntry[]> {
    return this.prisma.syncQueue.findMany({
      where: {
        operationType: { in: SUPPORTED_TYPES },
        status: { notIn: ['COMPLETED', 'PROCESSING', 'PERMANENT_FAILURE', 'DISCARDED'] },
        retryCount: { lt: MAX_RETRY_ATTEMPTS },
        OR: [
          { status: 'PENDING' },
          { status: 'FAILED', nextRetryAt: { lte: new Date() } },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      take: 20,
    }) as Promise<SyncQueueEntry[]>;
  }

  /** Dispatches a single entry and updates its status to COMPLETED. */
  private async processEntry(entry: SyncQueueEntry): Promise<void> {
    try {
      await this.prisma.syncQueue.update({
        where: { id: entry.id },
        data: { status: 'PROCESSING' },
      });

      const result = await this.dispatcher.dispatch(entry);

      // Clear any previous error message from a prior failed attempt —
      // a successful retry should not show stale error context. The
      // dispatcher's entityId / entityInternalCode are stamped here too
      // so a *_CREATION retried after the immediate-dispatch path
      // failed still surfaces the server-assigned ids in the eventual
      // ALREADY_ACCEPTED response on a subsequent push.
      await this.prisma.syncQueue.update({
        where: { id: entry.id },
        data: {
          status: 'COMPLETED',
          processedAt: new Date(),
          lastErrorMessage: null,
          entityId: result.entityId ?? null,
          entityInternalCode: result.entityInternalCode ?? null,
        },
      });
    } catch (error: unknown) {
      // DomainException subclasses (ProductNotFoundException, etc.) are
      // non-transient — the referenced entity genuinely does not exist
      // on the server and retrying will never succeed. Mark as permanent
      // failure immediately instead of burning 10 retries with 60s delays.
      if (error instanceof DomainException) {
        await this.markPermanentFailure(entry, error);
        return;
      }
      await this.markFailed(entry, error);
    }
  }

  /** Marks an entry as PERMANENT_FAILURE immediately — no more retries. */
  private async markPermanentFailure(entry: SyncQueueEntry, error: unknown): Promise<void> {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await this.prisma.syncQueue.update({
      where: { id: entry.id },
      data: {
        status: 'PERMANENT_FAILURE',
        retryCount: (entry.retryCount ?? 0) + 1,
        lastErrorMessage: `Permanent failure — no retry: ${errorMessage}`,
        nextRetryAt: null,
      },
    });

    this.logger.warn(
      `Sync operation ${entry.id} (${entry.operationType}) permanently failed: ${errorMessage}`,
    );
  }

  /** Marks an entry as FAILED, increments retry count, schedules next retry. */
  private async markFailed(entry: SyncQueueEntry, error: unknown): Promise<void> {
    const retryCount = (entry.retryCount ?? 0) + 1;
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    const exhausted = retryCount >= MAX_RETRY_ATTEMPTS;
    const data: Record<string, unknown> = {
      status: exhausted ? 'PERMANENT_FAILURE' : 'FAILED',
      retryCount,
      lastErrorMessage: exhausted
        ? `Exceeded max retry attempts (${MAX_RETRY_ATTEMPTS}): ${errorMessage}`
        : errorMessage,
      nextRetryAt: exhausted
        ? null
        : new Date(Date.now() + RETRY_FIXED_DELAY_SECONDS * 1000),
    };

    await this.prisma.syncQueue.update({
      where: { id: entry.id },
      data,
    });

    this.logger.warn(
      `Sync operation ${entry.id} (${entry.operationType}) failed: ${errorMessage}` +
        (exhausted ? ` — no more retries (max ${MAX_RETRY_ATTEMPTS})` : ` — retry ${retryCount}/${MAX_RETRY_ATTEMPTS}`),
    );
  }
}
