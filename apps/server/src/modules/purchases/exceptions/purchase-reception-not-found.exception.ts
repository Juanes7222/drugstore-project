import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PurchaseReceptionNotFoundException extends DomainException {
  constructor(receptionId: string) {
    super(
      'PURCHASE_RECEPTION_NOT_FOUND',
      `Purchase reception with ID ${receptionId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
