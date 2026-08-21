// Contract for data-import source adapters (CSV, Excel, JSON). Adding a new
// input type only requires implementing this interface and registering it.

import { ImportSourceFormat } from '@pharmacy/database';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';

/** Raw table extracted from an uploaded file. */
export interface ParsedImportTable {
  /** Header row, trimmed, as found in the file. */
  headers: string[];
  /** Data rows keyed by their header; missing cells become empty strings. */
  rows: Array<Record<string, unknown>>;
  /** Non-fatal parse observations surfaced to the user in the preview. */
  warnings: string[];
}

export interface ImportSourceAdapter {
  readonly format: ImportSourceFormat;
  parse(buffer: Buffer, fileName: string): Promise<ParsedImportTable>;
}

const EXTENSION_TO_FORMAT: Record<string, ImportSourceFormat> = {
  csv: ImportSourceFormat.CSV,
  txt: ImportSourceFormat.CSV,
  xlsx: ImportSourceFormat.XLSX,
  xls: ImportSourceFormat.XLSX,
  json: ImportSourceFormat.JSON,
};

/**
 * Resolves the import format from the file extension, falling back to
 * content sniffing (xlsx is a ZIP container; JSON starts with `{` or `[`).
 */
export function detectImportFormat(
  fileName: string,
  buffer: Buffer,
): ImportSourceFormat {
  const extension = fileName.split('.').pop()?.toLowerCase();
  const fromExtension = extension ? EXTENSION_TO_FORMAT[extension] : undefined;
  if (fromExtension) return fromExtension;

  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    return ImportSourceFormat.XLSX;
  }
  const firstByte = buffer[0];
  if (firstByte === 0x7b || firstByte === 0x5b) {
    return ImportSourceFormat.JSON;
  }
  return ImportSourceFormat.CSV;
}

/**
 * Decodes a buffer as UTF-8, falling back to Windows-1252 for CSV files
 * exported by Windows Excel, which often uses CP1252 without a BOM.
 */
export function decodeTextBuffer(buffer: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  return text.replace(/^\uFEFF/, '');
}

/** Throws when headers are duplicated after trimming — ambiguous mapping. */
export function assertUniqueHeaders(headers: string[]): void {
  const duplicates = headers.filter(
    (header, index) => header && headers.indexOf(header) !== index,
  );
  if (duplicates.length > 0) {
    throw new ImportFileInvalidException(
      `Duplicate column headers are not allowed: ${[...new Set(duplicates)].join(', ')}`,
    );
  }
}
