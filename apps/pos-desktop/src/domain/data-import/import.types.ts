/**
 * Public types for the local data-import flow. Shapes mirror the server's
 * data-import module (`ImportPreviewResult`, `ImportExecutionResult`,
 * `ImportRowError`) so the POS and the backoffice behave identically.
 */

import type { ImportIssue } from "@pharmacy/shared-validation";
import type { ImportSourceFormat } from "./import-common";

/** Raw table extracted from an uploaded file. */
export interface ParsedImportTable {
  /** Header row, trimmed, as found in the file. */
  headers: string[];
  /** Data rows keyed by their header; missing cells become empty strings. */
  rows: Array<Record<string, unknown>>;
  /** Non-fatal parse observations surfaced to the user in the preview. */
  warnings: string[];
}

/** Input for preview/execute — a file read into memory by the caller. */
export interface ImportFileInput {
  fileName: string;
  data: ArrayBuffer;
}

/** Entities the POS can import. Keys match the server's import definitions. */
export type ImportEntityKey = "products" | "clients";

/** Per-row validation/business error, `rowNumber` counting from the header. */
export interface ImportRowError {
  rowNumber: number;
  issues: ImportIssue[];
}

/** Preview result — nothing is written. */
export interface ImportPreviewResult {
  entityKey: ImportEntityKey;
  entityLabel: string;
  fileName: string;
  format: ImportSourceFormat;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportRowError[];
  validSample: Array<{ rowNumber: number; data: unknown }>;
  unmatchedHeaders: string[];
  warnings: string[];
}

/** Execution result — one record per import run, persisted locally. */
export interface ImportExecutionResult {
  importId: string;
  entityKey: ImportEntityKey;
  entityLabel: string;
  fileName: string;
  format: ImportSourceFormat;
  totalRows: number;
  validRows: number;
  errorRows: number;
  errors: ImportRowError[];
}

/** Lightweight persisted record of a completed import run. */
export interface ImportHistoryEntry {
  importId: string;
  entityKey: ImportEntityKey;
  entityLabel: string;
  fileName: string;
  format: ImportSourceFormat;
  totalRows: number;
  validRows: number;
  errorRows: number;
  createdAt: string;
  createdByUserId: string;
  /** Per-row errors, capped for storage. */
  errors: ImportRowError[];
}
