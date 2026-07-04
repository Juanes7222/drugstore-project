import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class AdjustmentNotDraftException extends DomainException {
  constructor(adjustmentId: string) {
    super(
      'ADJUSTMENT_NOT_DRAFT',
      `Adjustment document ${adjustmentId} is not in DRAFT state.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
