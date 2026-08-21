/**
 * JSON source parser — mirrors the server's json-source.adapter.ts rules:
 * accepts an array of objects or `{ headers, rows }` where rows are arrays
 * aligned with headers.
 */

import {
  assertUniqueHeaders,
  decodeTextBuffer,
  type ImportSourceFormat,
} from "../import-common";
import type { ParsedImportTable } from "../import.types";
import { ImportFileInvalidException } from "../exceptions";

export const jsonFormat: ImportSourceFormat = "JSON";

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a JSON file buffer into a header-keyed table. */
export async function parseJson(data: ArrayBuffer): Promise<ParsedImportTable> {
  const text = decodeTextBuffer(data);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ImportFileInvalidException(
      `The JSON file is invalid: ${(error as Error).message}`,
    );
  }

  if (Array.isArray(parsed)) {
    return parseObjectArray(parsed);
  }
  if (
    isJsonRecord(parsed) &&
    Array.isArray(parsed.headers) &&
    Array.isArray(parsed.rows)
  ) {
    return parseHeadersAndRows(parsed);
  }
  throw new ImportFileInvalidException(
    'The JSON file must be an array of objects or an object with "headers" and "rows" arrays',
  );
}

function parseObjectArray(items: unknown[]): ParsedImportTable {
  if (items.length === 0) {
    throw new ImportFileInvalidException("The JSON file contains no rows");
  }
  if (!items.every(isJsonRecord)) {
    throw new ImportFileInvalidException(
      "Every JSON array element must be an object",
    );
  }

  // First object's keys define the canonical order; later keys are appended.
  const headers = [...new Set(items.flatMap((item) => Object.keys(item)))];
  return {
    headers,
    rows: items.map((item) => {
      const record: JsonRecord = {};
      headers.forEach((header) => {
        record[header] = item[header] ?? "";
      });
      return record;
    }),
    warnings: [],
  };
}

function parseHeadersAndRows(payload: JsonRecord): ParsedImportTable {
  const headers = (payload.headers as unknown[]).map((value) =>
    String(value).trim(),
  );
  try {
    assertUniqueHeaders(headers);
  } catch (error) {
    throw new ImportFileInvalidException((error as Error).message);
  }

  const rows = (payload.rows as unknown[]).map((row) => {
    if (!Array.isArray(row)) {
      throw new ImportFileInvalidException(
        'Every "rows" element must be an array aligned with "headers"',
      );
    }
    const record: JsonRecord = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record;
  });

  return { headers, rows, warnings: [] };
}
