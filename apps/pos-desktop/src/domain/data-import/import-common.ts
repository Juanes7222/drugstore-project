/**
 * Shared data-import plumbing for the POS desktop app.
 *
 * The normalization helpers here mirror the server's
 * `apps/server/src/modules/data-import/import-definition.ts` /
 * `import-source.adapter.ts` so a CSV column means the same thing on every
 * side of the sync boundary. The column metadata itself lives in
 * `@pharmacy/shared-validation` and is never duplicated.
 */

import type {
  ImportColumnMeta,
  ImportIssue,
} from "@pharmacy/shared-validation";
import { ZodError } from "zod";

// ---------------------------------------------------------------------------
// Limits (mirror apps/server data-import constants)
// ---------------------------------------------------------------------------

/** Maximum data rows accepted per import file. */
export const MAX_IMPORT_ROWS = 5000;
/** Number of valid rows echoed back in a preview response. */
export const PREVIEW_SAMPLE_LIMIT = 5;
/** Cap on per-row errors attached to an execute response payload. */
export const EXECUTE_ERROR_PAYLOAD_LIMIT = 50;

// ---------------------------------------------------------------------------
// Import source formats
// ---------------------------------------------------------------------------

export type ImportSourceFormat = "CSV" | "XLSX" | "JSON";

const EXTENSION_TO_FORMAT: Record<string, ImportSourceFormat> = {
  csv: "CSV",
  txt: "CSV",
  xlsx: "XLSX",
  xls: "XLSX",
  json: "JSON",
};

/**
 * Resolves the import format from the file extension, falling back to
 * content sniffing (XLSX is a ZIP container starting with `PK`; JSON starts
 * with `{` or `[`).
 */
export function detectImportFormat(
  fileName: string,
  data: ArrayBuffer,
): ImportSourceFormat {
  const extension = fileName.split(".").pop()?.toLowerCase();
  const fromExtension = extension ? EXTENSION_TO_FORMAT[extension] : undefined;
  if (fromExtension) return fromExtension;

  const bytes = new Uint8Array(data);
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return "XLSX";
  }
  const firstByte = bytes[0];
  if (firstByte === 0x7b || firstByte === 0x5b) {
    return "JSON";
  }
  return "CSV";
}

// ---------------------------------------------------------------------------
// Text decoding
// ---------------------------------------------------------------------------

/**
 * Decodes a byte buffer as UTF-8, falling back to Windows-1252 (CP1252) for
 * CSV files exported by Windows Excel, which often uses that encoding
 * without a BOM. Strips a leading UTF-8 BOM. Note the fallback is CP1252,
 * not plain Latin-1: the 0x80–0x9F range differs (€, typographic quotes).
 */
export function decodeTextBuffer(data: ArrayBuffer): string {
  const bytes = new Uint8Array(data);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.replace(/^\uFEFF/, "");
}

// ---------------------------------------------------------------------------
// Header / cell normalization (mirror server import-definition.ts)
// ---------------------------------------------------------------------------

const NORMALIZABLE_ALIAS = new Set(["", "-", "n/a", "null", "undefined"]);

/**
 * Normalize a header or alias for comparison: lowercase, trimmed, accent
 * folding ("Código" → "codigo"), and whitespace collapse so
 * "Nombre Comercial" and "nombre_comercial" resolve to the same column.
 */
export function normalizeHeader(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Trims strings and maps placeholder/empty values to undefined. */
export function normalizeCellValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed === "" || NORMALIZABLE_ALIAS.has(trimmed.toLowerCase())) {
    return undefined;
  }
  return trimmed;
}

/**
 * Builds the header → canonical-key lookup used by mapColumns. Aliases and
 * canonical keys are compared normalized, so any alias variant resolves to
 * the same column key.
 */
export function buildAliasMap(
  columns: ImportColumnMeta[],
): Map<string, string> {
  const aliasMap = new Map<string, string>();
  for (const column of columns) {
    aliasMap.set(normalizeHeader(column.key), column.key);
    for (const alias of column.aliases) {
      aliasMap.set(normalizeHeader(alias), column.key);
    }
  }
  return aliasMap;
}

/** Converts a Zod error into the row-issue shape exposed by previews. */
export function zodIssuesToImportIssues(error: ZodError): ImportIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.length > 0 ? issue.path.join(".") : "row",
    message: issue.message,
  }));
}

/** Lists required columns whose headers are absent from the file. */
export function missingRequiredHeaders(
  columns: ImportColumnMeta[],
  headers: string[],
): string[] {
  const present = new Set(headers.map(normalizeHeader));
  return columns
    .filter(
      (column) =>
        column.required &&
        ![column.key, ...column.aliases].some((alias) =>
          present.has(normalizeHeader(alias)),
        ),
    )
    .map((column) => column.label);
}

/**
 * Throws when headers are duplicated after trimming — an ambiguous mapping
 * that must fail the file, never silently pick a column.
 */
export function assertUniqueHeaders(headers: string[]): void {
  const duplicates = headers.filter(
    (header, index) => header && headers.indexOf(header) !== index,
  );
  if (duplicates.length > 0) {
    throw new Error(
      `Duplicate column headers are not allowed: ${[...new Set(duplicates)].join(", ")}`,
    );
  }
}
