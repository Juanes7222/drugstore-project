import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PurchaseReceptionNotConfirmedException extends DomainException {
  constructor(receptionId: string) {
    super(
      'PURCHASE_RECEPTION_NOT_CONFIRMED',
      `Purchase reception ${receptionId} is not in CONFIRMED state and cannot be annulled.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
