/**
 * Domain exceptions for the fiscal / DIAN contingency module.
 */

import { DomainError } from '../../common/domain-error';

export class FiscalConfigurationError extends DomainError {
  constructor(message: string) {
    super('FISCAL_CONFIGURATION_ERROR', message);
  }
}

export class ContingencyTechKeyPlaceholderError extends DomainError {
  constructor() {
    super(
      'CONTINGENCY_TECH_KEY_PLACEHOLDER',
      'The workstation contingency tech key has not been configured. ' +
        'Sale confirmation is blocked until a real key is provided.',
    );
  }
}

export class FiscalCounterNotInitializedError extends DomainError {
  constructor(workstationId: string) {
    super(
      'FISCAL_COUNTER_NOT_INITIALIZED',
      `Fiscal counters for workstation ${workstationId} are not initialized. ` +
        'A manager must configure the authorized numbering range before sales can resume.',
    );
  }
}

export class FiscalCounterExhaustedError extends DomainError {
  constructor(type: string) {
    super(
      'FISCAL_COUNTER_EXHAUSTED',
      `The ${type} invoice numbering range has been exhausted. ` +
        'A new DIAN resolution must be configured before issuing more documents.',
    );
  }
}

export class InvoiceNotFoundException extends DomainError {
  constructor(invoiceId: string) {
    super('INVOICE_NOT_FOUND', `Invoice ${invoiceId} not found.`);
  }
}

export class InvoiceNotCancellableException extends DomainError {
  constructor(invoiceId: string, status: string) {
    super(
      'INVOICE_NOT_CANCELLABLE',
      `Invoice ${invoiceId} with status ${status} cannot be cancelled locally. ` +
        'After DIAN transmission, use the credit-note mechanism instead.',
    );
  }
}

export class NoActiveContingencyException extends DomainError {
  constructor() {
    super('NO_ACTIVE_CONTINGENCY', 'There is no active contingency event to end.');
  }
}

export class SaleMissingForInvoiceException extends DomainError {
  constructor(saleId: string) {
    super('SALE_MISSING_FOR_INVOICE', `Sale ${saleId} not found; cannot generate invoice.`);
  }
}

export class ReturnMissingForCreditNoteException extends DomainError {
  constructor(returnId: string) {
    super(
      'RETURN_MISSING_FOR_CREDIT_NOTE',
      `Return ${returnId} not found; cannot generate credit note.`,
    );
  }
}
