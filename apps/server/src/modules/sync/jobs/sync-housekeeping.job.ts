import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { EnvConfig } from '@/config/env.schema';
import { SyncEventService } from '../services/sync-event.service';
import { WorkstationHeartbeatService } from '../services/workstation-heartbeat.service';

/**
 * Collects the sync tables that only ever grow.
 *
 * `SyncQueue` is the only table whose retention window had a job behind it.
 * `SyncEventService.deleteExpired()`, `WorkstationHeartbeatService.deleteOld()`
 * and `RevocationListService.cleanOldEntries()` were written, documented as
 * housekeeping and never called, so their rows accumulated for the entire life
 * of a deployment. This job covers the two high-volume sync tables; the
 * revocation list is auth-domain (one row per revoked offline token) and stays
 * with its owner.
 *
 * Two scoping rules, deliberately different:
 *   - SyncEvent carries a subscriptionId and is RLS-scoped, so the purge runs
 *     tenant by tenant inside withTenant. Without a tenant context the delete
 *     matches zero rows and still reports success, which is how a purge can look
 *     wired up and do nothing.
 *   - WorkstationHeartbeat has no subscriptionId (a terminal reports before any
 *     tenant request is in flight), so it is one global pass.
 *
 * Volume, for context: heartbeats arrive every heartbeat interval and a hub
 * writes one row per terminal it reports for, which makes this the
 * highest-write-rate table in the schema. Events carry a per-event TTL and their
 * acknowledgement rows cascade away with them.
 */
@Injectable()
export class SyncHousekeepingJob {
  private readonly logger = new Logger(SyncHousekeepingJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<EnvConfig>,
    private readonly syncEventService: SyncEventService,
    private readonly heartbeatService: WorkstationHeartbeatService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async purgeExpiredRows(): Promise<void> {
    const retentionHours = this.configService.getOrThrow(
      'HEARTBEAT_RETENTION_HOURS',
    );

    const subscriptions = await this.prisma.subscription.findMany({
      select: { id: true },
    });

    let eventsDeleted = 0;
    for (const subscription of subscriptions) {
      eventsDeleted += await this.prisma.withTenant(subscription.id, () =>
        this.syncEventService.deleteExpired(),
      );
    }

    const heartbeatsDeleted =
      await this.heartbeatService.deleteOld(retentionHours);

    if (eventsDeleted > 0 || heartbeatsDeleted > 0) {
      this.logger.log(
        `Housekeeping: deleted ${eventsDeleted} expired sync event(s) and ` +
          `${heartbeatsDeleted} heartbeat(s) older than ${retentionHours}h`,
      );
    }
  }
}
