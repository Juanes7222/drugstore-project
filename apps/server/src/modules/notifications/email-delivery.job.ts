import { Inject, Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EMAILS_QUEUE, MAIL_PROVIDER } from './mail.port';
import type { MailProvider } from './mail.port';
import type { EmailJobData } from './mail.types';
import { MailTemplatesService } from './mail-templates.service';

/**
 * Consumes the emails queue in-process. Renders the template and hands the
 * finished message to the configured driver; every failure is rethrown so
 * BullMQ applies the retry/backoff policy configured on the job.
 *
 * Runs outside any tenant transaction — the job only needs the recipient address
 * already carried in the payload, so it touches no tenant-scoped table.
 */
@Processor(EMAILS_QUEUE)
@Injectable()
export class EmailDeliveryJob extends WorkerHost {
  private readonly logger = new Logger(EmailDeliveryJob.name);

  constructor(
    @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
    private readonly templates: MailTemplatesService,
  ) {
    super();
  }

  async process(job: Job<EmailJobData>): Promise<void> {
    const mail = this.templates.render(job.data.template, {
      to: job.data.to,
      recipientName: job.data.recipientName,
      token: job.data.token,
      idempotencyKey: job.data.idempotencyKey,
      expiresAt: new Date(job.data.expiresAt),
    });

    try {
      await this.provider.send(mail);
    } catch (error) {
      // The rendered body embeds the capability token, so it is deliberately
      // absent from this message; only the failure reason is recorded.
      this.logger.warn(
        `Mail delivery failed (driver=${this.provider.driver}, attempt=${job.attemptsMade + 1}): ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
