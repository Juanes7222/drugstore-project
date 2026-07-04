import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class MissingClosingCashCountsException extends DomainException {
  constructor(missingPaymentMethods: string[]) {
    super(
      'MISSING_CLOSING_CASH_COUNTS',
      `Missing closing cash counts for payment methods: ${missingPaymentMethods.join(', ')}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
