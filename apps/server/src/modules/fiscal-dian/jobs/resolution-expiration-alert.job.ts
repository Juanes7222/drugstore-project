import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

/**
 * Days before validTo at which an ACTIVE resolution transitions to EXPIRING.
 * This is a named constant so it can be adjusted centrally.
 */
const EXPIRING_THRESHOLD_DAYS = 30;

@Injectable()
export class ResolutionExpirationAlertJob {
  private readonly logger = new Logger(ResolutionExpirationAlertJob.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Runs once daily. Transitions ACTIVE resolutions to EXPIRING when their
   * validTo is within a threshold, and ACTIVE or EXPIRING to EXPIRED once
   * validTo has passed.
   *
   * The cron tick has no request context, and FiscalResolution rows are
   * RLS-scoped — iterate tenant by tenant inside withTenant so the
   * updateMany is not silently empty.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkExpirations(): Promise<void> {
    const subscriptions = await this.prisma.subscription.findMany({
      select: { id: true },
    });

    for (const subscription of subscriptions) {
      await this.prisma.withTenant(subscription.id, async () => {
        const now = new Date();
        const threshold = new Date(
          now.getTime() + EXPIRING_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
        );

        await this.markExpiring(now, threshold);
        await this.markExpired(now);
      });
    }
  }

  /** Marks ACTIVE resolutions whose validTo falls within the threshold as EXPIRING. */
  private async markExpiring(now: Date, threshold: Date): Promise<void> {
    const result = await this.prisma.fiscalResolution.updateMany({
      where: {
        state: 'ACTIVE',
        validTo: { gte: now, lte: threshold },
      },
      data: { state: 'EXPIRING' },
    });
    if (result.count > 0) {
      this.logger.log(`${result.count} resolution(s) marked as EXPIRING`);
    }
  }

  /** Marks ACTIVE or EXPIRING resolutions past their validTo as EXPIRED. */
  private async markExpired(now: Date): Promise<void> {
    const result = await this.prisma.fiscalResolution.updateMany({
      where: {
        state: { in: ['ACTIVE', 'EXPIRING'] },
        validTo: { lt: now },
      },
      data: { state: 'EXPIRED' },
    });
    if (result.count > 0) {
      this.logger.log(`${result.count} resolution(s) marked as EXPIRED`);
    }
  }
}
