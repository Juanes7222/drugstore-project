import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when an attempt is made to retry a FiscalDocument whose current state
 * does not support retry (e.g., VALIDATED, PENDING_TRANSMISSION, ANNULLED).
 */
export class DocumentNotRetryableException extends DomainException {
  constructor(fiscalDocumentId: string, currentState: string) {
    super(
      'DOCUMENT_NOT_RETRYABLE',
      `Fiscal document "${fiscalDocumentId}" is in state "${currentState}" which cannot be retried`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
