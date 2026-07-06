import { HttpStatus } from '@nestjs/common';
import { DomainException } from '../../../common/exceptions/domain.exception';

/**
 * Thrown when DIAN responds with IsValid=false, indicating the document
 * was structurally or cryptographically rejected. A rejected document
 * needs human investigation, not an automatic resend.
 */
export class FiscalDocumentRejectedException extends DomainException {
  constructor(documentId: string, dianMessage: string) {
    super(
      'FISCAL_DOCUMENT_REJECTED',
      `Fiscal document "${documentId}" was rejected by DIAN: ${dianMessage}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
