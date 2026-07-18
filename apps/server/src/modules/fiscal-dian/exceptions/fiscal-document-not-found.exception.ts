import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a FiscalDocument lookup by id returns no result.
 */
export class FiscalDocumentNotFoundException extends DomainException {
  constructor(fiscalDocumentId: string) {
    super(
      'FISCAL_DOCUMENT_NOT_FOUND',
      `Fiscal document "${fiscalDocumentId}" not found`,
      HttpStatus.NOT_FOUND,
    );
  }
}
