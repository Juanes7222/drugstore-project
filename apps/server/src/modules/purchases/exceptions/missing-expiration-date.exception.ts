import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class MissingExpirationDateException extends DomainException {
  constructor(receptionItemId: string) {
    super(
      'RECEPTION_ITEM_MISSING_EXPIRATION_DATE',
      `Reception item ${receptionItemId} is missing an expiration date and cannot be confirmed.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
