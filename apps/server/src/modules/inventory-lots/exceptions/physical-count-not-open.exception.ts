import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PhysicalCountNotOpenException extends DomainException {
  constructor(countId: string) {
    super(
      'PHYSICAL_COUNT_NOT_OPEN',
      `Physical count ${countId} is not in OPEN state.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
