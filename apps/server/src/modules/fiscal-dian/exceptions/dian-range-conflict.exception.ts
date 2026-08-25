import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/** One range DIAN returned that cannot be applied to the local catalog. */
export interface DianRangeConflict {
  resolutionNumber: string;
  prefix: string;
  reason: string;
}

/**
 * Thrown (all-or-nothing, inside the request transaction) when at least one
 * range fetched from DIAN conflicts with an existing ACTIVE resolution —
 * same resolution number with different bounds/dates, or a new range
 * overlapping an active (workstationId, documentType, prefix) tuple. The
 * admin must resolve the conflict manually; nothing is partially applied.
 */
export class DianRangeConflictException extends DomainException {
  constructor(readonly conflicts: DianRangeConflict[]) {
    super(
      'DIAN_RANGE_CONFLICT',
      `${conflicts.length} numbering range(s) from DIAN conflict with existing resolutions`,
      HttpStatus.CONFLICT,
    );
  }
}
