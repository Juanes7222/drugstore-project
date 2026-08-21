import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { IMPORT_ERROR_CODES } from '../constants/import.constants';

/**
 * Business-level rejection of a single row during execute (e.g. a referenced
 * category does not exist). Caught by DataImportService and recorded as a
 * per-row error; the import continues with the remaining rows.
 */
export class ImportRowRejectedException extends DomainException {
  constructor(message: string) {
    super(
      IMPORT_ERROR_CODES.ROW_REJECTED,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
