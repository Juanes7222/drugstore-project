import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { LotState } from '@pharmacy/database';

export class LotNotEligibleForReturnException extends DomainException {
  constructor(lotId: string, currentState: LotState) {
    super(
      'LOT_NOT_ELIGIBLE_FOR_RETURN',
      `Lot ${lotId} is in state ${currentState} and cannot accept returned stock. Only ACTIVE or EXHAUSTED lots are eligible.`,
      HttpStatus.CONFLICT,
    );
  }
}
