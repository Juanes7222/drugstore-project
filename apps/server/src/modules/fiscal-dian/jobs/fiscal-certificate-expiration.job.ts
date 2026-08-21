import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

/**
 * Transitions ACTIVE certificates whose validTo has passed to EXPIRED.
 * Expiry is a hard stop for the DIAN_DIRECT path — an expired certificate
 * must never be selected for signing, so the transition happens the moment
 * the date passes, without waiting for a manual action.
 *
 * The cron tick has no request context and FiscalCertificate rows are
 * RLS-scoped — iterate tenant by tenant inside withTenant so the
 * updateMany is not silently empty.
 */
@Injectable()
export class FiscalCertificateExpirationJob {
  private readonly logger = new Logger(FiscalCertificateExpirationJob.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async checkExpirations(): Promise<void> {
    const subscriptions = await this.prisma.subscription.findMany({
      select: { id: true },
    });

    for (const subscription of subscriptions) {
      await this.prisma.withTenant(subscription.id, async () => {
        const result = await this.prisma.fiscalCertificate.updateMany({
          where: {
            status: 'ACTIVE',
            validTo: { lt: new Date() },
          },
          data: { status: 'EXPIRED' },
        });
        if (result.count > 0) {
          this.logger.log(
            `${result.count} certificate(s) expired for subscription ${subscription.id}`,
          );
        }
      });
    }
  }
}
