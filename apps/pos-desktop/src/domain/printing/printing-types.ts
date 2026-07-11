/**
 * Shared types for the printing subsystem.
 *
 * These types map to the Prisma enums and models defined in the local-only
 * printing.prisma schema fragment. They are re-exported here to avoid
 * coupling every domain service directly to the generated Prisma types.
 */

// ---------------------------------------------------------------------------
// Printer types
// ---------------------------------------------------------------------------

export enum PrinterType {
  THERMAL_RECEIPT = 'THERMAL_RECEIPT',
  THERMAL_LABEL = 'THERMAL_LABEL',
  LASER = 'LASER',
  INKJET = 'INKJET',
  MULTIFUNCTION = 'MULTIFUNCTION',
  UNKNOWN = 'UNKNOWN',
}

export enum PrinterConnection {
  USB = 'USB',
  NETWORK = 'NETWORK',
  BLUETOOTH = 'BLUETOOTH',
  SERIAL = 'SERIAL',
  SYSTEM_DEFAULT = 'SYSTEM_DEFAULT',
}

export enum PaperSize {
  RECEIPT_80MM = 'RECEIPT_80MM',
  RECEIPT_58MM = 'RECEIPT_58MM',
  RECEIPT_76MM = 'RECEIPT_76MM',
  LETTER = 'LETTER',
  A4 = 'A4',
  LABEL_50X25 = 'LABEL_50X25',
  LABEL_62X29 = 'LABEL_62X29',
  LABEL_OTHER = 'LABEL_OTHER',
  CUSTOM = 'CUSTOM',
  UNKNOWN = 'UNKNOWN',
}

export enum PrinterStatusCode {
  ONLINE = 'ONLINE',
  OFFLINE = 'OFFLINE',
  ERROR = 'ERROR',
  NO_PAPER = 'NO_PAPER',
  UNKNOWN = 'UNKNOWN',
}

// ---------------------------------------------------------------------------
// Job types
// ---------------------------------------------------------------------------

export enum PrintJobType {
  SALE_RECEIPT = 'SALE_RECEIPT',
  ELECTRONIC_INVOICE = 'ELECTRONIC_INVOICE',
  CREDIT_NOTE = 'CREDIT_NOTE',
  CONTINGENCY_RECEIPT = 'CONTINGENCY_RECEIPT',
  INVENTORY_REPORT = 'INVENTORY_REPORT',
  SHIFT_CLOSE_REPORT = 'SHIFT_CLOSE_REPORT',
  LABEL_PRINT = 'LABEL_PRINT',
  TEST_PAGE = 'TEST_PAGE',
  OTHER = 'OTHER',
}

export enum PrintPayloadType {
  PDF = 'PDF',
  ESC_POS = 'ESC_POS',
  RAW = 'RAW',
  HTML = 'HTML',
  LABEL_IMAGE = 'LABEL_IMAGE',
}

export enum PrintJobStatus {
  PENDING = 'PENDING',
  PRINTING = 'PRINTING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  DISCARDED = 'DISCARDED',
  RETRYING = 'RETRYING',
}

// ---------------------------------------------------------------------------
// Template types
// ---------------------------------------------------------------------------

export enum TemplateFormat {
  ESC_POS_LAYOUT = 'ESC_POS_LAYOUT',
  PDF_TEMPLATE = 'PDF_TEMPLATE',
  HTML_TEMPLATE = 'HTML_TEMPLATE',
}

export enum QRCodeContent {
  INVOICE_NUMBER_AND_CUFE = 'INVOICE_NUMBER_AND_CUFE',
  CUFE_ONLY = 'CUFE_ONLY',
  INVOICE_URL = 'INVOICE_URL',
  NONE = 'NONE',
}

// ---------------------------------------------------------------------------
// Peripheral device config
// ---------------------------------------------------------------------------

export type CashDrawerOpenMode = 'ALWAYS' | 'CASH_ONLY' | 'MANUAL';

export interface CashDrawerConfig {
  hasDrawer: boolean;
  openMode: CashDrawerOpenMode;
  autoCloseAfterSeconds: number;
  /** ESC/POS kick command bytes, default: 0x1B 0x70 0x00 0x32 0xFA */
  kickCommand: number[];
}

export type CustomerDisplayMode = 'LINE_ITEMS' | 'TOTAL_ONLY' | 'TOTAL_AND_CHANGE';

export interface CustomerDisplayConfig {
  hasDisplay: boolean;
  mode: CustomerDisplayMode;
  welcomeMessage: string;
  thankYouMessage: string;
  idleMessage: string;
  encoding: 'CP437' | 'CP850' | 'UTF8';
}

export interface DisplayContent {
  lineItems?: string[];
  total?: string;
  changeDue?: string;
  message?: string;
}

export interface DrawerResult {
  success: boolean;
  errorMessage?: string;
}

// ---------------------------------------------------------------------------
// Template context for placeholder substitution
// ---------------------------------------------------------------------------

export interface VariableContext {
  sale?: Record<string, unknown>;
  invoice?: Record<string, unknown>;
  client?: Record<string, unknown>;
  product?: Record<string, unknown>;
  shift?: Record<string, unknown>;
  report?: Record<string, unknown>;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Data transfer interfaces
// ---------------------------------------------------------------------------

/** A printer as stored in the local config. */
export interface PrinterConfigRecord {
  id: string;
  friendlyName: string;
  systemName: string;
  printerType: PrinterType;
  connection: PrinterConnection;
  paperSize: PaperSize;
  customPaperWidthMm: number | null;
  customPaperHeightMm: number | null;
  supportsColor: boolean;
  supportsDuplex: boolean;
  assignedJobs: string[];
  fallbackPrinterId: string | null;
  serverFallbackEnabled: boolean;
  cashDrawerConfig: string | null;
  customerDisplayConfig: string | null;
  receiptTemplateId: string | null;
  status: PrinterStatusCode;
  lastStatusCheck: Date | null;
  lastErrorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Input for creating or updating a printer config. */
export interface PrinterConfigInput {
  friendlyName: string;
  systemName: string;
  printerType: PrinterType;
  connection: PrinterConnection;
  paperSize: PaperSize;
  customPaperWidthMm?: number | null;
  customPaperHeightMm?: number | null;
  supportsColor: boolean;
  supportsDuplex?: boolean;
  assignedJobs: string[];
  fallbackPrinterId?: string | null;
  serverFallbackEnabled?: boolean;
}

/** A print job as stored in the local queue. */
export interface PrintJobRecord {
  id: string;
  jobType: PrintJobType;
  printerConfigId: string | null;
  payloadPath: string;
  payloadType: PrintPayloadType;
  templateVariables: string | null;
  status: PrintJobStatus;
  attempts: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  createdBySaleId: string | null;
  createdByUserId: string | null;
  routingLog: string | null;
}

/** Input for enqueuing a print job. */
export interface PrintJobInput {
  jobType: PrintJobType;
  /** Full local file path to the printable payload. */
  payloadPath: string;
  payloadType?: PrintPayloadType;
  templateVariables?: string | null;
  createdBySaleId?: string | null;
  createdByUserId?: string | null;
}

/** A printer as discovered by the OS. */
export interface DiscoveredPrinter {
  systemName: string;
  friendlyName: string;
  connection: string;
  isDefault: boolean;
  printerType: string;
  supportsColor: boolean;
  detectedPaperSize: string;
  detectionConfidence: string;
}

/** Result of a paper size detection query. */
export interface PrinterPaperSizeResult {
  paperSize: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  description: string;
  charWidth: number;
}

/** Result of a test print operation from the Rust backend. */
export interface TestPrintResult {
  success: boolean;
  errorMessage?: string | null;
  paperOut?: boolean | null;
}

/** Status of a printer from the Rust backend. */
export interface PrinterStatusResult {
  status: string;
  statusMessage?: string | null;
}

// ---------------------------------------------------------------------------
// Metrics types
// ---------------------------------------------------------------------------

export interface PrintQueueSummary {
  pending: number;
  printing: number;
  failed: number;
  discarded: number;
  completed24h: number;
  averageAttemptsBeforeSuccess: number;
}

export interface PrinterStatusSummary {
  online: number;
  offline: number;
  error: number;
  noPaper: number;
  unknown: number;
}

// ---------------------------------------------------------------------------
// Config export/import types
// ---------------------------------------------------------------------------

/** The serializable format for cross-station config export. */
export interface ExportedPrinterConfig {
  version: number;
  exportedAt: string;
  printers: ExportedPrinterEntry[];
}

export interface ExportedPrinterEntry {
  friendlyName: string;
  printerType: PrinterType;
  connection: PrinterConnection;
  paperSize: PaperSize;
  supportsColor: boolean;
  supportsDuplex?: boolean;
  assignedJobs: string[];
  serverFallbackEnabled: boolean;
  cashDrawerConfig?: string | null;
  customerDisplayConfig?: string | null;
  receiptTemplateId?: string | null;
  /** The index into the printers array for the fallback. Null if no fallback. */
  fallbackPrinterIndex?: number | null;
}

export interface ImportReport {
  totalInConfig: number;
  matched: number;
  unmatched: ImportUnmatchedEntry[];
  warnings: string[];
}

export interface ImportUnmatchedEntry {
  friendlyName: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Receipt template types
// ---------------------------------------------------------------------------

export interface ReceiptTemplateRecord {
  id: string;
  name: string;
  targetPrinterType: PrinterType;
  paperSize: PaperSize;
  templateFormat: TemplateFormat;
  templateBody: string;
  headerLines: string[];
  footerLines: string[];
  showQrCode: boolean;
  qrCodeContent: QRCodeContent;
  showLogo: boolean;
  logoPath: string | null;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReceiptTemplateInput {
  name: string;
  targetPrinterType: PrinterType;
  paperSize: PaperSize;
  templateFormat: TemplateFormat;
  templateBody: string;
  headerLines: string[];
  footerLines: string[];
  showQrCode?: boolean;
  qrCodeContent?: QRCodeContent;
  showLogo?: boolean;
  logoPath?: string | null;
  isDefault?: boolean;
}
