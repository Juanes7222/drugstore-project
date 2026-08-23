export { calculateProvisionalCufe } from './cufe';

export {
  createContingencyService,
} from './contingency.service';
export type {
  ContingencyService,
  ContingencyServiceConfig,
} from './contingency.service';

export { useContingencyStore } from './contingency.store';
export type { ContingencyState, ContingencyActions } from './contingency.store';

export {
  createFiscalNumberingService,
} from './numbering.service';
export type {
  FiscalNumberingService,
  FiscalNumberingConfig,
  InitializeCountersInput,
} from './numbering.service';

export {
  createInvoiceService,
} from './invoice.service';
export type {
  InvoiceService,
  InvoiceServiceConfig,
} from './invoice.service';

export {
  createFiscalScheduler,
} from './fiscal-scheduler.service';
export type {
  FiscalScheduler,
  FiscalSchedulerConfig,
  FiscalCheckResult,
} from './fiscal-scheduler.service';

export { generateReceiptHtml, printReceipt, createReceiptBlobUrl } from './receipt-generator';

export type {
  InvoiceType,
  InvoiceStatus,
  ContingencyTrigger,
  InvoiceLineItem,
  InvoicePayment,
  InvoiceTaxSummary,
  InvoiceBuyer,
  InvoiceSeller,
  InvoiceFullData,
  CufeInvoiceData,
  InvoiceModel,
  InvoiceListItem,
  ContingencyEventSummary,
  FiscalSummary,
  CreditNoteInput,
} from './fiscal-types';

export {
  FiscalConfigurationError,
  ContingencyTechKeyPlaceholderError,
  FiscalCounterNotInitializedError,
  FiscalCounterExhaustedError,
  InvoiceNotFoundException,
  InvoiceNotCancellableException,
  NoActiveContingencyException,
  SaleMissingForInvoiceException,
  ReturnMissingForCreditNoteException,
} from './exceptions';

// Local adjustment layer
export { createLocalAdjustmentService } from './local-adjustment.service';
export type { LocalAdjustmentService } from './local-adjustment.service';

export type {
  AdjustmentType,
  AdjustmentRecord,
  AdjustmentHistoryEntry,
  OperationalInvoiceView,
  OperationalNote,
  OperationalContactInfo,
  OperationalClient,
  OperationalDeliveryInfo,
  LocalAdjustmentSummary,
  ReportView,
  AdjustmentCsvRow,
} from './local-adjustment.types';

export {
  AdjustmentAuthorizationException,
  AdjustmentInvoiceNotFoundException,
  AdjustmentNotAllowedForStatusException,
  AdjustmentReasonTooShortException,
  AdjustmentNotFoundException,
  AdjustmentAlreadyReversedException,
  AdjustmentConflictException,
} from './local-adjustment.exceptions';

// DIAN digital certificate (self-managed billing plan)
export { FiscalCertificateService } from './certificate.service';
export type {
  FiscalCertificateSummary,
  CertificateUploadInput,
  CertificateValidationResult,
  FiscalCertificateHttpClient,
  FiscalCertificateServiceConfig,
} from './certificate.service';
export { useCertificateStore, CERTIFICATE_EXPIRY_WARNING_DAYS } from './certificate.store';
export type { CertificateStatus, CertificateSummary } from './certificate.store';
export {
  CertificateInvalidFileException,
  CertificateUploadRejectedException,
  CertificateUploadOfflineException,
} from './exceptions';
export type { CertificateValidationCode } from './exceptions';
