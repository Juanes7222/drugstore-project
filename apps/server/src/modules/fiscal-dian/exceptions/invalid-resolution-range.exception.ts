import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when FiscalResolution.rangeFrom exceeds rangeTo.
 */
export class InvalidResolutionRangeException extends DomainException {
  constructor() {
    super(
      'INVALID_RESOLUTION_RANGE',
      'Range start must not exceed range end',
      HttpStatus.BAD_REQUEST,
    );
  }
}
