import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PhysicalCountNotCountedException extends DomainException {
  constructor(countId: string) {
    super(
      'PHYSICAL_COUNT_NOT_COUNTED',
      `Physical count ${countId} is not in COUNTED state.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
