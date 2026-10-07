import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import {
  EMAILS_QUEUE,
  MAIL_DELIVERY_ATTEMPTS,
  MAIL_DELIVERY_BACKOFF_MS,
} from './mail.port';
import type { EmailJobData } from './mail.types';
import type {
  EmailVerificationMailParams,
  PasswordResetMailParams,
} from './mail.types';

/**
 * Entry point domain modules use to request transactional mail. Callers never
 * see the provider, the queue, or the template names' internals — they say
 * "send this verification link" and the delivery concerns stay here.
 *
 * Sending is queued rather than performed inline because every HTTP handler in
 * this app runs inside an RLS transaction that holds a pooled database
 * connection for the request's full duration; a synchronous provider call would
 * extend that hold by the provider's latency. Queuing also isolates provider
 * retries and lets an Idempotency-Key suppress duplicate deliveries.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(
    @InjectQueue(EMAILS_QUEUE) private readonly emailsQueue: Queue,
    private readonly tenantContext: TenantContextService,
  ) {}

  /** Queues the account-verification email carrying a single-use link. */
  async sendEmailVerification(
    params: EmailVerificationMailParams,
  ): Promise<void> {
    await this.dispatch({
      template: 'EMAIL_VERIFICATION',
      to: params.to,
      recipientName: params.recipientName,
      token: params.token,
      idempotencyKey: params.idempotencyKey,
      expiresAt: params.expiresAt.toISOString(),
    });
  }

  /** Queues the password-reset email carrying a single-use link. */
  async sendPasswordReset(params: PasswordResetMailParams): Promise<void> {
    await this.dispatch({
      template: 'PASSWORD_RESET',
      to: params.to,
      recipientName: params.recipientName,
      token: params.token,
      idempotencyKey: params.idempotencyKey,
      expiresAt: params.expiresAt.toISOString(),
    });
  }

  /**
   * Enqueues the job, deferring to after-commit when the caller is inside a
   * request transaction.
   *
   * Publishing a job for a write that later rolls back would mail a user a link
   * to a token row that does not exist, so inside a tenant context the enqueue
   * is registered with TenantContextService instead of run immediately.
   * Unauthenticated endpoints (forgot-password, resend-verification) have no
   * tenant context and their writes have already auto-committed, so there the
   * job goes on the queue straight away.
   */
  private async dispatch(data: EmailJobData): Promise<void> {
    const options = {
      attempts: MAIL_DELIVERY_ATTEMPTS,
      backoff: {
        type: 'exponential' as const,
        delay: MAIL_DELIVERY_BACKOFF_MS,
      },
      removeOnComplete: true,
      // Expired-but-unprocessed jobs are dropped after a day rather than
      // retrying a link whose token is no longer valid.
      removeOnFail: { age: 86_400 },
    };

    if (this.tenantContext.hasTenant()) {
      this.tenantContext.registerAfterCommit(async () => {
        await this.emailsQueue.add('send', data, options);
      });
      return;
    }

    await this.emailsQueue.add('send', data, options);
    this.logger.log(`Queued ${data.template} mail`);
  }
}
