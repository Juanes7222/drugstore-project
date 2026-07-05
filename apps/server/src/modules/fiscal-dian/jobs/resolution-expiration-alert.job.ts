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
   * validTo is within the threshold, and ACTIVE or EXPIRING to EXPIRED once
   * validTo has passed.
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkExpirations(): Promise<void> {
    const now = new Date();
    const threshold = new Date(
      now.getTime() + EXPIRING_THRESHOLD_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.markExpiring(now, threshold);
    await this.markExpired(now);
  }

  /** Marks ACTIVE resolutions whose validTo falls within the threshold as EXPIRING. */
  private async markExpiring(now: Date, threshold: Date): Promise<void> {
    const result = await (this.prisma.fiscalResolution as any).updateMany({
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
    const result = await (this.prisma.fiscalResolution as any).updateMany({
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
