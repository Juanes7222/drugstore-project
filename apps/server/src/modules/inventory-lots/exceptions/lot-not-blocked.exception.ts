import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class LotNotBlockedException extends DomainException {
  constructor(lotId: string) {
    super(
      'LOT_NOT_BLOCKED',
      `Lot ${lotId} is not in a blocked state and cannot be unblocked.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
