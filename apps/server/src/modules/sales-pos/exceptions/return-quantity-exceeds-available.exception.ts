import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class ReturnQuantityExceedsAvailableException extends DomainException {
  constructor(saleItemId: string, requested: number, available: number) {
    super(
      'RETURN_QUANTITY_EXCEEDS_AVAILABLE',
      `Return quantity ${requested} for sale item ${saleItemId} exceeds available quantity ${available}.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
