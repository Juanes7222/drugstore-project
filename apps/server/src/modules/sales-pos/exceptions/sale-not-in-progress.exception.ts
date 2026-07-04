import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SaleNotInProgressException extends DomainException {
  constructor(saleId: string) {
    super(
      'SALE_NOT_IN_PROGRESS',
      `Sale ${saleId} is not in IN_PROGRESS state and cannot be confirmed.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
