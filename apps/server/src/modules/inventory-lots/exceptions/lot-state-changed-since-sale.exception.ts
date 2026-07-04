import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { LotState } from '@prisma/client';

export class LotStateChangedSinceSaleException extends DomainException {
  constructor(lotId: string, currentState: LotState) {
    super(
      'LOT_STATE_CHANGED_SINCE_SALE',
      `Lot ${lotId} is in state ${currentState} and cannot be automatically restored. Manual intervention required.`,
      HttpStatus.CONFLICT,
    );
  }
}
