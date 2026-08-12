import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class CreditRequiresRegisteredClientException extends DomainException {
  constructor() {
    super(
      'CREDIT_REQUIRES_REGISTERED_CLIENT',
      'Store credit payments are only allowed for registered clients.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
