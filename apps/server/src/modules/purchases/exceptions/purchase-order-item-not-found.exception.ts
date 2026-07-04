import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PurchaseOrderItemNotFoundException extends DomainException {
  constructor(itemId: string) {
    super(
      'PURCHASE_ORDER_ITEM_NOT_FOUND',
      `Purchase order item with ID ${itemId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
