import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { IMPORT_ERROR_CODES } from '../constants/import.constants';

export class ImportFileInvalidException extends DomainException {
  constructor(message: string) {
    super(IMPORT_ERROR_CODES.FILE_INVALID, message, HttpStatus.BAD_REQUEST);
  }
}
