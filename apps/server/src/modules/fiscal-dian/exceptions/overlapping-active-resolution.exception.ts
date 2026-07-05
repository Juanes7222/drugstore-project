import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when attempting to create a FiscalResolution that overlaps an
 * existing ACTIVE resolution on (workstationId, documentType, prefix).
 * The partial unique constraint is deferred to a raw-SQL migration so this
 * check is performed manually — same defensive pattern as TaxScheme overlapping.
 */
export class OverlappingActiveResolutionException extends DomainException {
  constructor(documentType: string, prefix: string) {
    super(
      'OVERLAPPING_ACTIVE_RESOLUTION',
      `An active resolution already exists for document type "${documentType}" with prefix "${prefix}"`,
      HttpStatus.CONFLICT,
    );
  }
}
