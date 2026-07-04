import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class LotNotFoundException extends DomainException {
  constructor(lotId: string) {
    super(
      'LOT_NOT_FOUND',
      `Lot with ID ${lotId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
