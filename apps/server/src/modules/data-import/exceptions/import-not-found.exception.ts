import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { IMPORT_ERROR_CODES } from '../constants/import.constants';

export class ImportNotFoundException extends DomainException {
  constructor(importId: string) {
    super(
      IMPORT_ERROR_CODES.DEFINITION_NOT_FOUND,
      `No import record found with id "${importId}"`,
      HttpStatus.NOT_FOUND,
    );
  }
}
