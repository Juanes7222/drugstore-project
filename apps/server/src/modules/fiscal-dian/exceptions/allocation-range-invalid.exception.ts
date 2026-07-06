import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a FiscalResolutionAllocation's rangeFrom/rangeTo fall outside
 * the parent resolution's own range, or overlap another allocation's range.
 */
export class AllocationRangeInvalidException extends DomainException {
  constructor(message: string) {
    super(
      'ALLOCATION_RANGE_INVALID',
      message,
      HttpStatus.BAD_REQUEST,
    );
  }
}
