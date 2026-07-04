import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PurchaseReceptionNotDraftException extends DomainException {
  constructor(receptionId: string) {
    super(
      'PURCHASE_RECEPTION_NOT_DRAFT',
      `Purchase reception ${receptionId} is not in DRAFT state and cannot be confirmed.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
