import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class InsufficientStockException extends DomainException {
  constructor(productId: string, requestedQuantity: number, availableQuantity: number) {
    super(
      'INSUFFICIENT_STOCK',
      `Insufficient stock for product ${productId}. Requested: ${requestedQuantity}, Available: ${availableQuantity}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
