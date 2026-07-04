import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PurchaseOrderNotFoundException extends DomainException {
  constructor(purchaseOrderId: string) {
    super(
      'PURCHASE_ORDER_NOT_FOUND',
      `Purchase order with ID ${purchaseOrderId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
