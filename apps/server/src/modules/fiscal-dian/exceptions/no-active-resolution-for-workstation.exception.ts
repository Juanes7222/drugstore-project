import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when no active FiscalResolutionAllocation exists for the workstation
 * with a parent resolution matching the required document type.
 */
export class NoActiveResolutionForWorkstationException extends DomainException {
  constructor(workstationId: string, documentType: string) {
    super(
      'NO_ACTIVE_RESOLUTION_FOR_WORKSTATION',
      `No active resolution allocation found for workstation "${workstationId}" with document type "${documentType}"`,
      HttpStatus.PRECONDITION_FAILED,
    );
  }
}
