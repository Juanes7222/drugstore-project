import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class LotCostUnavailableException extends DomainException {
  constructor(lotId: string) {
    super(
      'LOT_COST_UNAVAILABLE',
      `Unit cost for lot ${lotId} is unavailable. This lot was likely not received through a purchase.`, 
      HttpStatus.BAD_REQUEST,
    );
  }
}
