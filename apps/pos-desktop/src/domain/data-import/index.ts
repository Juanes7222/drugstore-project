/**
 * Data-import module barrel — exports the import service and its public
 * types. Internal helpers (parsers, definitions) stay unexported.
 */

export { createImportService } from "./import.service";
export type { ImportService, ImportServiceDeps } from "./import.service";
export type {
  ImportEntityKey,
  ImportFileInput,
  ImportHistoryEntry,
  ImportPreviewResult,
  ImportExecutionResult,
  ImportRowError,
  ParsedImportTable,
} from "./import.types";
export type { ImportSourceFormat } from "./import-common";
export {
  ImportFileInvalidException,
  ImportValidationFailedException,
  ImportRowRejectedException,
  ImportExecutionFailedException,
} from "./exceptions";
