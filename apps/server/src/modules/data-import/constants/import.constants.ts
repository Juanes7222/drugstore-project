// Central limits and error codes for the data-import module.

export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024;
/** Number of valid rows echoed back in a preview response. */
export const PREVIEW_SAMPLE_LIMIT = 5;
/** Cap on per-row errors attached to an execute response payload. */
export const EXECUTE_ERROR_PAYLOAD_LIMIT = 50;
/** Rows per committed transaction in the async worker. */
export const IMPORT_CHUNK_SIZE = 200;

export const IMPORTS_QUEUE = 'imports';
export const IMPORT_JOB_NAME = 'import';

export const IMPORT_ERROR_CODES = {
  DEFINITION_NOT_FOUND: 'IMPORT_DEFINITION_NOT_FOUND',
  FILE_INVALID: 'IMPORT_FILE_INVALID',
  VALIDATION_FAILED: 'IMPORT_VALIDATION_FAILED',
  ROW_REJECTED: 'IMPORT_ROW_REJECTED',
  EXECUTION_FAILED: 'IMPORT_EXECUTION_FAILED',
} as const;
