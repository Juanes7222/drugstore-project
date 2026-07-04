import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PhysicalCountNotApprovedException extends DomainException {
  constructor(countId: string) {
    super(
      'PHYSICAL_COUNT_NOT_APPROVED',
      `Physical count ${countId} is not in APPROVED state.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
