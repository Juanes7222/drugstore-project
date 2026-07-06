import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when a client return's sale either has no FiscalDocument of type
 * INVOICE, or the invoice exists but was never VALIDATED.  A credit note is
 * only meaningful against a validated electronic invoice, not a POS_TICKET.
 */
export class NoValidatedInvoiceForCreditNoteException extends DomainException {
  constructor(
    saleId: string,
    actualDocumentType?: string,
    actualFiscalState?: string,
  ) {
    const detail =
      actualDocumentType && actualFiscalState
        ? `sale "${saleId}" has a ${actualDocumentType} in state ${actualFiscalState}`
        : `sale "${saleId}" has no fiscal document at all`;
    super(
      'NO_VALIDATED_INVOICE_FOR_CREDIT_NOTE',
      `Cannot create CREDIT_NOTE: ${detail}. A validated INVOICE is required.`,
      HttpStatus.PRECONDITION_FAILED,
    );
  }
}
