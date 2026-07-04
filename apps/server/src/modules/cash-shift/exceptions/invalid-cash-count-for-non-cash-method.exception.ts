import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class InvalidCashCountForNonCashMethodException extends DomainException {
  constructor() {
    super(
      'INVALID_CASH_COUNT_FOR_NON_CASH_METHOD',
      'Denominations breakdown is only allowed for cash payment methods',
      HttpStatus.BAD_REQUEST,
    );
  }
}
