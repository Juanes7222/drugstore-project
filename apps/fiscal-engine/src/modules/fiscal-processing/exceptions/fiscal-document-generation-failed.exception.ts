import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception';

/**
 * Thrown when XML generation or CUFE computation fails for a fiscal document.
 * The processor uses this to transition the document to GENERATION_ERROR.
 */
export class FiscalDocumentGenerationFailedException extends DomainException {
  constructor(documentId: string, cause: string) {
    super(
      'FISCAL_DOCUMENT_GENERATION_FAILED',
      `Failed to generate fiscal document "${documentId}": ${cause}`,
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}