import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SaleNotFoundException extends DomainException {
  constructor(saleId: string) {
    super(
      'SALE_NOT_FOUND',
      `Sale with ID ${saleId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
