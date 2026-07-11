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
  SYSTEM_DEFAULT = 'SYSTEM_DEFAULT',
}

export enum PaperSize {
  RECEIPT_80MM = 'RECEIPT_80MM',
  RECEIPT_58MM = 'RECEIPT_58MM',
  LETTER = 'LETTER',
  A4 = 'A4',
  LABEL_50X25 = 'LABEL_50X25',
  LABEL_OTHER = 'LABEL_OTHER',
  CUSTOM = 'CUSTOM',
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
  TEST_PAGE = 'TEST_PAGE',
  OTHER = 'OTHER',
}

export enum PrintPayloadType {
  PDF = 'PDF',
  ESC_POS = 'ESC_POS',
  RAW = 'RAW',
  HTML = 'HTML',
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
  supportsColor: boolean;
  assignedJobs: string[];
  fallbackPrinterId: string | null;
  serverFallbackEnabled: boolean;
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
  supportsColor: boolean;
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
  assignedJobs: string[];
  serverFallbackEnabled: boolean;
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
