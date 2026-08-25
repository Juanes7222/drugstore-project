import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SubscriptionNotFoundException extends DomainException {
  constructor(subscriptionId: string) {
    super(
      'SUBSCRIPTION_NOT_FOUND',
      `Subscription with ID ${subscriptionId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
