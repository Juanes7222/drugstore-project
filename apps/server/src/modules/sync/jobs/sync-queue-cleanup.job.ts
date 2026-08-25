import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { EnvConfig } from '@/config/env.schema';

/** Rows deleted per deleteMany pass, to keep individual statements short-locked. */
const PURGE_BATCH_SIZE = 500;

/**
 * Deletes finished SyncQueue rows older than the retention window.
 *
 * The queue only ever grows: every replayed operation ends COMPLETED,
 * PERMANENT_FAILURE or DISCARDED and stays forever, bloating the table and
 * every index on it. Terminal-failure rows are purged on the same clock as
 * completed ones — debugging information survives for the full window.
 *
 * Cron ticks have no request context and SyncQueue is RLS-scoped, so the
 * purge iterates tenant by tenant inside withTenant (same contract as the
 * other scheduled jobs).
 */
@Injectable()
export class SyncQueueCleanupJob {
  private readonly logger = new Logger(SyncQueueCleanupJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvConfig>,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async purgeFinishedRows(): Promise<void> {
    const retentionDays = this.configService.getOrThrow(
      'SYNC_QUEUE_RETENTION_DAYS',
    );
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
    const subscriptions = await this.prisma.subscription.findMany({
      select: { id: true },
    });

    let totalDeleted = 0;
    for (const subscription of subscriptions) {
      totalDeleted += await this.prisma.withTenant(subscription.id, () =>
        this.purgeTenantBatched(cutoff),
      );
    }

    if (totalDeleted > 0) {
      this.logger.log(
        `Purged ${totalDeleted} finished sync-queue row(s) older than ${retentionDays} day(s)`,
      );
    }
  }

  /** Deletes one bounded batch per pass until the tenant has no rows left. */
  private async purgeTenantBatched(cutoff: Date): Promise<number> {
    let deleted = 0;
    for (;;) {
      const batch = await this.prisma.syncQueue.findMany({
        where: {
          status: { in: ['COMPLETED', 'PERMANENT_FAILURE', 'DISCARDED'] },
          OR: [
            { processedAt: { lt: cutoff } },
            { processedAt: null, receivedAt: { lt: cutoff } },
          ],
        },
        select: { id: true },
        take: PURGE_BATCH_SIZE,
      });
      if (batch.length === 0) break;

      const result = await this.prisma.syncQueue.deleteMany({
        where: { id: { in: batch.map((r) => r.id) } },
      });
      deleted += result.count;
      if (batch.length < PURGE_BATCH_SIZE) break;
    }
    return deleted;
  }
}
