/**
 * CSV source parser — mirrors the server's csv-source.adapter.ts rules:
 * UTF-8 with Latin-1 fallback, BOM stripped, first row is the header,
 * duplicate/empty header names fail the file, cells stay raw strings
 * (conversion happens in the shared row schemas).
 */

import Papa from "papaparse";
import {
  assertUniqueHeaders,
  decodeTextBuffer,
  type ImportSourceFormat,
} from "../import-common";
import type { ParsedImportTable } from "../import.types";
import { ImportFileInvalidException } from "../exceptions";

export const csvFormat: ImportSourceFormat = "CSV";

/** Parse a CSV file buffer into a header-keyed table. */
export async function parseCsv(data: ArrayBuffer): Promise<ParsedImportTable> {
  const text = decodeTextBuffer(data);
  if (!text.trim()) {
    throw new ImportFileInvalidException("The CSV file is empty");
  }

  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
    // Cells stay strings; conversion happens in the definition schemas.
    dynamicTyping: false,
  });

  const rows = result.data;
  const headerRow = rows[0];
  if (!headerRow || headerRow.every((cell) => !cell.trim())) {
    // Known limitation (same as the server): with skipEmptyLines "greedy"
    // and a headerless file, the first data row is silently consumed as the
    // header — this guard only fires on a blank first line. Detecting the
    // headerless case at parse time is unreliable here: the parser is
    // format-agnostic (no column metadata) and dynamicTyping:false makes
    // every cell a string, so a "header looks like data" heuristic can't
    // distinguish. The missing-required-column validation downstream is the
    // actual backstop for headerless files.
    throw new ImportFileInvalidException(
      "The CSV file has no header row; the first row must contain column names",
    );
  }

  const headers = headerRow.map((cell) => cell.trim());
  if (headers.some((header) => !header)) {
    throw new ImportFileInvalidException(
      "The CSV header row contains empty column names",
    );
  }
  try {
    assertUniqueHeaders(headers);
  } catch (error) {
    throw new ImportFileInvalidException((error as Error).message);
  }

  return {
    headers,
    rows: rows.slice(1).map((row) => {
      const record: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        record[header] = row[index] ?? "";
      });
      return record;
    }),
    warnings: result.errors.map((error) => `CSV parse issue: ${error.message}`),
  };
}
