import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class LotNotActiveException extends DomainException {
  constructor(lotId: string) {
    super(
      'LOT_NOT_ACTIVE',
      `Lot ${lotId} is not in an active state and cannot be blocked.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
