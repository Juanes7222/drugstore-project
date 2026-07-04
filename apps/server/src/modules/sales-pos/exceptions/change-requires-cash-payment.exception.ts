import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ChangeRequiresCashPaymentException extends DomainException {
  constructor() {
    super(
      'CHANGE_REQUIRES_CASH_PAYMENT',
      'Change can only be returned if at least one payment method is cash.',
      HttpStatus.BAD_REQUEST,
    );
  }
}
