import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ProductNotFoundException extends DomainException {
  constructor(productId: string) {
    super(
      'PRODUCT_NOT_FOUND',
      `Product with ID ${productId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
