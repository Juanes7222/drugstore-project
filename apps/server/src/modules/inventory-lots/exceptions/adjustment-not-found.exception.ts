import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class AdjustmentNotFoundException extends DomainException {
  constructor(adjustmentId: string) {
    super(
      'ADJUSTMENT_NOT_FOUND',
      `Adjustment document with ID ${adjustmentId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
