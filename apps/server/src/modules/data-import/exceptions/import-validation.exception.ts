import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { IMPORT_ERROR_CODES } from '../constants/import.constants';
import type { ImportIssue } from '@pharmacy/shared-validation';

export interface ImportValidationFailure {
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: Array<{ rowNumber: number; issues: ImportIssue[] }>;
}

/**
 * Thrown when an execute request contains at least one invalid row. Nothing
 * is written in that case; the client must fix the rows and retry. The full
 * per-row error list is exposed through the filter's `details` payload.
 */
export class ImportValidationException extends DomainException {
  constructor(readonly failure: ImportValidationFailure) {
    super(
      IMPORT_ERROR_CODES.VALIDATION_FAILED,
      `Import validation failed: ${failure.errorRows} of ${failure.totalRows} rows contain errors; nothing was imported`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }

  getResponse(): {
    message: string;
    errors: ImportValidationFailure['errors'];
  } {
    return { message: this.message, errors: this.failure.errors };
  }
}
