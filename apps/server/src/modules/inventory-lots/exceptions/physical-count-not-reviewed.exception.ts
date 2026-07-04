import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PhysicalCountNotReviewedException extends DomainException {
  constructor(countId: string) {
    super(
      'PHYSICAL_COUNT_NOT_REVIEWED',
      `Physical count ${countId} is not in REVIEWED state.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
