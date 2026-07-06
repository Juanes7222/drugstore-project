import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a FiscalDocument already exists for the given (saleId, documentType)
 * pair. The composite unique constraint is deferred to a raw-SQL migration,
 * so this check is performed manually.
 */
export class DuplicateFiscalDocumentException extends DomainException {
  constructor(saleId: string, documentType: string) {
    super(
      'DUPLICATE_FISCAL_DOCUMENT',
      `A fiscal document of type "${documentType}" already exists for sale "${saleId}"`,
      HttpStatus.CONFLICT,
    );
  }
}
