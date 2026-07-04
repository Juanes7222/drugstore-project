import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class AdjustmentNotApprovedException extends DomainException {
  constructor(adjustmentId: string) {
    super(
      'ADJUSTMENT_NOT_APPROVED',
      `Adjustment document ${adjustmentId} is not in APPROVED state.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
