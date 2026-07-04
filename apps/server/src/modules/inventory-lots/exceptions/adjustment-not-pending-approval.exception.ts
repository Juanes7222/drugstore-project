import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class AdjustmentNotPendingApprovalException extends DomainException {
  constructor(adjustmentId: string) {
    super(
      'ADJUSTMENT_NOT_PENDING_APPROVAL',
      `Adjustment document ${adjustmentId} is not in PENDING_APPROVAL state.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
