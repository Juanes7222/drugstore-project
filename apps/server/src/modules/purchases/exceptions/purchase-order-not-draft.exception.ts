import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PurchaseOrderNotDraftException extends DomainException {
  constructor(orderId: string) {
    super(
      'PURCHASE_ORDER_NOT_DRAFT',
      `Purchase order ${orderId} is not in DRAFT state and cannot be confirmed.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
