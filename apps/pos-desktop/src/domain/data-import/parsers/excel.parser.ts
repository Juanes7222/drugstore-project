/**
 * Excel source parser — mirrors the server's excel-source.adapter.ts rules:
 * first worksheet, first row is the header, duplicate/empty header names
 * fail the file, numbers keep their raw value (no thousand separators),
 * date cells render as ISO yyyy-mm-dd, formula/rich-text cells use the
 * cell's display text.
 */

import ExcelJS from "exceljs";
import { assertUniqueHeaders, type ImportSourceFormat } from "../import-common";
import type { ParsedImportTable } from "../import.types";
import { ImportFileInvalidException } from "../exceptions";

export const excelFormat: ImportSourceFormat = "XLSX";

/** Parse an XLSX workbook buffer (first worksheet) into a header-keyed table. */
export async function parseExcel(
  data: ArrayBuffer,
): Promise<ParsedImportTable> {
  let workbook: ExcelJS.Workbook;
  try {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data);
  } catch {
    throw new ImportFileInvalidException(
      "The file is not a valid Excel workbook",
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    // Defensive: exceljs only ever yields a workbook with at least one
    // worksheet, so this branch is unreachable in practice, but a corrupt
    // workbook that loads without sheets must still fail the file.
    throw new ImportFileInvalidException("The Excel file has no worksheets");
  }

  const headerValues = (sheet.getRow(1).values ?? []) as unknown[];
  const headers = headerValues
    .slice(1)
    .map((value) => String(value ?? "").trim());
  if (headers.length === 0 || headers.every((header) => !header)) {
    throw new ImportFileInvalidException(
      "The Excel file has no header row; the first row must contain column names",
    );
  }
  if (headers.some((header) => !header)) {
    throw new ImportFileInvalidException(
      "The Excel header row contains empty column names",
    );
  }
  try {
    assertUniqueHeaders(headers);
  } catch (error) {
    throw new ImportFileInvalidException((error as Error).message);
  }

  const rows: Array<Record<string, unknown>> = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    // exceljs only allocates cells that hold values; an untouched row has
    // cellCount 0 and is skipped as a stray blank line.
    if (row.cellCount === 0) return;

    const record: Record<string, unknown> = {};
    headers.forEach((header, index) => {
      record[header] = cellToRawString(row.getCell(index + 1));
    });
    rows.push(record);
  });

  return { headers, rows, warnings: [] };
}

/**
 * Extracts a stable string from a cell: numbers and booleans keep their raw
 * value (no thousand separators), dates render as ISO yyyy-mm-dd.
 */
function cellToRawString(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    // exceljs 4.4 Cell.text renders Date values via raw JS Date.toString(),
    // ignoring the cell number format — unusable for imports. Emit the ISO
    // date part instead, which the row schemas can parse reliably.
    if (value instanceof Date) return formatIsoDate(value);
    if (
      "richText" in value &&
      Array.isArray((value as { richText: Array<{ text: string }> }).richText)
    ) {
      return (value as { richText: Array<{ text: string }> }).richText
        .map((part) => part.text)
        .join("");
    }
    return cell.text || "";
  }
  return String(value);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
