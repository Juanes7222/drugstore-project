import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/** Thrown when the next consecutive would exceed the allocation's rangeTo. */
export class ResolutionExhaustedException extends DomainException {
  constructor(allocationId: string) {
    super(
      'RESOLUTION_EXHAUSTED',
      `Fiscal resolution allocation "${allocationId}" has exhausted its available range`,
      HttpStatus.CONFLICT,
    );
  }
}
