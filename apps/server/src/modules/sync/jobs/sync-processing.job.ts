import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SyncOperationDispatcherService } from '../sync-operation-dispatcher.service';

/**
 * Fixed delay between retries for FAILED entries, in seconds.
 * This phase uses a fixed delay rather than exponential backoff; the latter
 * is a valid refinement for a later iteration, not a correctness requirement now.
 */
const RETRY_FIXED_DELAY_SECONDS = 60;

/** Operation types that the cron job replays. */
const SUPPORTED_TYPES = [
  'SALE_CONFIRMATION' as const,
  'SHIFT_CLOSURE' as const,
  'CLIENT_CREATION' as const,
  'INVENTORY_ADJUSTMENT' as const,
];

@Injectable()
export class SyncProcessingJob {
  private readonly logger = new Logger(SyncProcessingJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly dispatcher: SyncOperationDispatcherService,
  ) {}

  /**
   * Picks up PENDING and retryable FAILED entries of supported types.
   * Unsupported types (FISCAL_DOCUMENT_SYNC, PRESCRIPTION_REGISTRATION,
   * RESOLUTION_ALLOCATION) are never selected.
   */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async processPendingOperations(): Promise<void> {
    const entries = await this.fetchSupportedEntries();
    for (const entry of entries) {
      await this.processEntry(entry);
    }
  }

  /** Queries for supported entries that are ready to process. */
  private async fetchSupportedEntries(): Promise<any[]> {
    return this.prisma.syncQueue.findMany({
      where: {
        operationType: { in: SUPPORTED_TYPES },
        OR: [
          { status: 'PENDING' },
          { status: 'FAILED', nextRetryAt: { lte: new Date() } },
        ],
      },
      orderBy: { receivedAt: 'asc' },
      take: 20,
    });
  }

  /** Dispatches a single entry and updates its status to COMPLETED. */
  private async processEntry(entry: any): Promise<void> {
    try {
      await this.prisma.syncQueue.update({
        where: { id: entry.id },
        data: { status: 'PROCESSING' },
      });

      await this.dispatcher.dispatch(entry);

      await this.prisma.syncQueue.update({
        where: { id: entry.id },
        data: { status: 'COMPLETED', processedAt: new Date() },
      });
    } catch (error: any) {
      await this.markFailed(entry, error);
    }
  }

  /** Marks an entry as FAILED, increments retry count, schedules next retry. */
  private async markFailed(entry: any, error: any): Promise<void> {
    const retryCount = (entry.retryCount ?? 0) + 1;
    const nextRetryAt = new Date(
      Date.now() + RETRY_FIXED_DELAY_SECONDS * 1000,
    );

    await this.prisma.syncQueue.update({
      where: { id: entry.id },
      data: {
        status: 'FAILED',
        retryCount,
        lastErrorMessage: error.message ?? 'Unknown error',
        nextRetryAt,
      },
    });

    this.logger.warn(
      `Sync operation ${entry.id} (${entry.operationType}) failed: ${error.message}`,
    );
  }
}
