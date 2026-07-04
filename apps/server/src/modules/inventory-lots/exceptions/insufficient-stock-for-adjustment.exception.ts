import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class InsufficientStockForAdjustmentException extends DomainException {
  constructor(lotId: string, requestedQuantity: number, availableQuantity: number) {
    super(
      'INSUFFICIENT_STOCK_FOR_ADJUSTMENT',
      `Insufficient stock for adjustment on lot ${lotId}. Requested reduction: ${requestedQuantity}, Available: ${availableQuantity}.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
