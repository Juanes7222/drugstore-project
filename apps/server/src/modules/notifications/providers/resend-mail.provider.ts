import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import type { EnvConfig } from '@/config/env.schema';
import type { MailProvider, RenderedMail } from '../mail.port';

/**
 * Resend delivery channel for transactional mail.
 *
 * Send failures are raised, never swallowed: the BullMQ worker rethrows so the
 * job's retry and backoff policy applies, and after the final attempt the job
 * is recorded as failed. The rendered body is never logged here — it embeds the
 * verification capability token.
 */
@Injectable()
export class ResendMailProvider implements MailProvider {
  readonly driver = 'resend';

  private readonly logger = new Logger(ResendMailProvider.name);
  private readonly client: Resend;
  private readonly from: string;
  private readonly replyTo: string | undefined;

  constructor(configService: ConfigService<EnvConfig>) {
    this.client = new Resend(configService.get('RESEND_API_KEY') as string);
    this.from = configService.get('EMAIL_FROM') as string;
    this.replyTo = configService.get('EMAIL_REPLY_TO');
  }

  async send(mail: RenderedMail): Promise<void> {
    // The idempotency key goes in via the SDK's options argument only. Passing
    // it a second time as a literal header risks a duplicate-header rejection.
    const { error } = await this.client.emails.send(
      {
        from: this.from,
        to: mail.to,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        tags: mail.tags,
        ...(this.replyTo ? { reply_to: this.replyTo } : {}),
      },
      { idempotencyKey: mail.idempotencyKey },
    );

    if (error) {
      throw new Error(`Resend rejected the message: ${error.name}`);
    }

    this.logger.log(`Mail sent via Resend (template=${mail.tags[0]?.value})`);
  }
}
