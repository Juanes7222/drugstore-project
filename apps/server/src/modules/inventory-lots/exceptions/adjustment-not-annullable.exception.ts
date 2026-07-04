import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class AdjustmentNotAnnullableException extends DomainException {
  constructor(adjustmentId: string) {
    super(
      'ADJUSTMENT_NOT_ANNULLABLE',
      `Adjustment document ${adjustmentId} is already APPLIED and cannot be annulled.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
