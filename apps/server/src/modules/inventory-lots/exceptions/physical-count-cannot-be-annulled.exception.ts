import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PhysicalCountCannotBeAnnulledException extends DomainException {
  constructor(countId: string) {
    super(
      'PHYSICAL_COUNT_CANNOT_BE_ANNULLED',
      `Physical count ${countId} is already APPLIED and cannot be annulled.`,
      HttpStatus.BAD_REQUEST,
    );
  }
}
