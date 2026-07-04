import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PurchaseOrderItemMismatchException extends DomainException {
  constructor(receptionItemId: string, reason: string) {
    super(
      'PURCHASE_ORDER_ITEM_MISMATCH',
      `Purchase reception item ${receptionItemId} mismatch: ${reason}`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
