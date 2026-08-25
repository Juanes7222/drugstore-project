import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

/** 409 — reactivate is only legal from SUSPENDED or PAST_DUE. */
export class SubscriptionCannotBeReactivatedException extends DomainException {
  constructor(subscriptionId: string, status: string) {
    super(
      'SUBSCRIPTION_CANNOT_REACTIVATE',
      `Cannot reactivate subscription ${subscriptionId} in status ${status}; only SUSPENDED or PAST_DUE subscriptions can be reactivated`,
      HttpStatus.CONFLICT,
    );
  }
}
