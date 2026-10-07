import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { EnvConfig } from '@/config/env.schema';
import { TenantModule } from '@/modules/tenant/tenant.module';
import { EmailDeliveryJob } from './email-delivery.job';
import { MAIL_PROVIDER } from './mail.port';
import { MailService } from './mail.service';
import { MailTemplatesService } from './mail-templates.service';
import { createMailProvider } from './mail.factory';

/**
 * Outbound transactional mail. Owns the provider boundary (console | resend),
 * template rendering, and the BullMQ delivery worker; domain modules depend
 * only on MailService.
 */
@Module({
  imports: [BullModule.registerQueue({ name: 'emails' }), TenantModule],
  providers: [
    {
      provide: MAIL_PROVIDER,
      useFactory: (configService: ConfigService<EnvConfig>) =>
        createMailProvider(configService),
      inject: [ConfigService],
    },
    MailTemplatesService,
    MailService,
    EmailDeliveryJob,
  ],
  exports: [MailService],
})
export class NotificationsModule {}
