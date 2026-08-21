import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';
import { IMPORT_ERROR_CODES } from '../constants/import.constants';

export class ImportDefinitionNotFoundException extends DomainException {
  constructor(entityKey: string) {
    super(
      IMPORT_ERROR_CODES.DEFINITION_NOT_FOUND,
      `No import definition registered for entity "${entityKey}"`,
      HttpStatus.NOT_FOUND,
    );
  }
}
