import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class StaleAdjustmentException extends DomainException {
  constructor(adjustmentId: string, lotId: string, expectedStock: number, actualStock: number) {
    super(
      'STALE_ADJUSTMENT',
      `Adjustment ${adjustmentId} cannot be applied because lot ${lotId} stock has changed. Expected ${expectedStock}, actual ${actualStock}.`,
      HttpStatus.CONFLICT,
    );
  }
}
