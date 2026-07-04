import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

export class PhysicalCountNotFoundException extends DomainException {
  constructor(countId: string) {
    super(
      'PHYSICAL_COUNT_NOT_FOUND',
      `Physical count with ID ${countId} not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
