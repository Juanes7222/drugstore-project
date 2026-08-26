import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

/**
 * Thrown by GET /cash-shifts/open when the tenant has no OPEN shift.
 *
 * Maps to HTTP 404 (not an error state for the caller — the POS mirror
 * client treats it as "closed, do not sell offline until an admin opens").
 */
export class NoOpenShiftException extends DomainException {
  constructor() {
    super(
      'NO_OPEN_CASH_SHIFT',
      'No cash shift is currently open for this store.',
      HttpStatus.NOT_FOUND,
    );
  }
}
