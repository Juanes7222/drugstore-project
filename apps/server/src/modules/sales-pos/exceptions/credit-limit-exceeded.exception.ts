import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class CreditLimitExceededException extends DomainException {
  constructor(available: number, requested: number) {
    super(
      'CREDIT_LIMIT_EXCEEDED',
      `Credit amount (${requested}) exceeds the client's available balance (${available}).`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
