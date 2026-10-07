import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { VerificationTokenService } from '../services/verification-token.service';

/**
 * Deletes spent verification and password-reset tokens.
 *
 * The table gains a row on every issuance and rows are never removed by the
 * request path: consuming one marks it used, it does not delete it. Without
 * this job the table and its indexes grow without bound.
 *
 * Seven days is well past the longest TTL (24h for verification), so the delay
 * costs nothing and keeps a short window of forensic history for an audit that
 * asks who requested a reset and when.
 *
 * The table has no RLS policy, so unlike the tenant-scoped cleanup jobs this one
 * needs no per-tenant iteration.
 */
@Injectable()
export class VerificationTokenCleanupJob {
  private readonly logger = new Logger(VerificationTokenCleanupJob.name);

  constructor(
    private readonly verificationTokenService: VerificationTokenService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async purgeSpentTokens(): Promise<void> {
    try {
      await this.verificationTokenService.purgeExpired();
    } catch (error) {
      // A failed purge must not take down the scheduler; the next tick retries.
      this.logger.error(
        `Verification token purge failed: ${(error as Error).message}`,
      );
    }
  }
}
