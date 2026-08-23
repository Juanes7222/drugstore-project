/**
 * Data-import domain errors for the POS desktop app.
 *
 * Every exception extends the shared `DomainError` base so callers can
 * branch on a stable `errorCode` instead of string matching.
 */

import { DomainError } from "../../common/domain-error";

/**
 * Thrown when a file cannot be parsed at all: empty file, no header row,
 * empty or duplicate column names, malformed JSON/Excel, over row limit,
 * or missing required columns. File-level — nothing is written.
 */
export class ImportFileInvalidException extends DomainError {
  constructor(message: string) {
    super("IMPORT_FILE_INVALID", message);
  }
}

/**
 * Thrown by `execute` when rows fail shared-schema validation. Mirrors the
 * server contract: the preview surfaces these errors before execute, so an
 * execute run with validation errors aborts before a single write.
 */
export class ImportValidationFailedException extends DomainError {
  constructor(message: string) {
    super("IMPORT_VALIDATION_FAILED", message);
  }
}

/**
 * Thrown when a single row cannot be written for a business reason (e.g.
 * the category name does not exist locally). The import run catches this
 * per row, records the row as ERROR, and continues with the rest.
 */
export class ImportRowRejectedException extends DomainError {
  constructor(message: string) {
    super("IMPORT_ROW_REJECTED", message);
  }
}

/**
 * Thrown when the import run fails with an unexpected error (anything that
 * is not a per-row rejection). Mirrors the server's
 * ImportExecutionFailedException.
 */
export class ImportExecutionFailedException extends DomainError {
  constructor(message: string) {
    super("IMPORT_EXECUTION_FAILED", message);
  }
}

/**
 * Thrown when a downloadable template cannot be generated (e.g. the
 * catalog queries backing the XLSX dropdowns fail).
 */
export class ImportTemplateFailedException extends DomainError {
  constructor(message: string, readonly cause?: unknown) {
    super("IMPORT_TEMPLATE_FAILED", message);
  }
}
