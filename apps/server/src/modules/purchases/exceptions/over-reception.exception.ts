import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class OverReceptionException extends DomainException {
  constructor(purchaseOrderItemId: string, requestedQuantity: number, receivedQuantity: number) {
    super(
      'OVER_RECEPTION',
      `Received quantity (${receivedQuantity}) for purchase order item ${purchaseOrderItemId} exceeds pending quantity (${requestedQuantity}).`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
