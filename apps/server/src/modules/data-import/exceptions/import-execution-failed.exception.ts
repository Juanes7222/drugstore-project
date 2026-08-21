import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { IMPORT_ERROR_CODES } from '../constants/import.constants';

/** Unexpected failure while committing an import; the whole run rolled back. */
export class ImportExecutionFailedException extends DomainException {
  constructor(message: string) {
    super(
      IMPORT_ERROR_CODES.EXECUTION_FAILED,
      `Import failed and was rolled back: ${message}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}
