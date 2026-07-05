import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class SaleItemNotFoundException extends DomainException {
  constructor(saleItemId: string) {
    super(
      'SALE_ITEM_NOT_FOUND',
      `Sale item with ID ${saleItemId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
