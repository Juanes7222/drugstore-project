import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SaleNotConfirmedException extends DomainException {
  constructor(saleId: string) {
    super(
      'SALE_NOT_CONFIRMED',
      `Sale ${saleId} is not in CONFIRMED state and cannot be annulled.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
