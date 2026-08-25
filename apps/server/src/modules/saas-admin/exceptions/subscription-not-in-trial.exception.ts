import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

/** 409 — trial extension is only legal while the subscription is TRIAL. */
export class SubscriptionNotInTrialException extends DomainException {
  constructor(subscriptionId: string, status: string) {
    super(
      'SUBSCRIPTION_NOT_IN_TRIAL',
      `Cannot extend trial of subscription ${subscriptionId} in status ${status}; only TRIAL subscriptions have an extendable trial`,
      HttpStatus.CONFLICT,
    );
  }
}
