// exceljs is CommonJS-only; named ESM imports fail at Node link time, so
// Workbook is pulled off the default export instead.
import exceljs from 'exceljs';
import type { Cell, CellValue, CellRichTextValue, Workbook } from 'exceljs';
import { ImportSourceFormat } from '@pharmacy/database';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';
import {
  ImportSourceAdapter,
  ParsedImportTable,
  assertUniqueHeaders,
} from './import-source.adapter';

const { Workbook: WorkbookCtor } = exceljs;

export class ExcelSourceAdapter implements ImportSourceAdapter {
  readonly format = ImportSourceFormat.XLSX;

  async parse(buffer: Buffer): Promise<ParsedImportTable> {
    let workbook: Workbook;
    try {
      workbook = new WorkbookCtor();
      // exceljs declares an older Node Buffer type; the runtime value is the
      // same buffer either way.
      await workbook.xlsx.load(
        buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
    } catch {
      throw new ImportFileInvalidException(
        'The file is not a valid Excel workbook',
      );
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new ImportFileInvalidException('The Excel file has no worksheets');
    }

    const headerValues = (sheet.getRow(1).values ??
      []) as unknown as CellValue[];
    const headers = headerValues
      .slice(1)
      .map((value) => String(value ?? '').trim());
    if (headers.length === 0 || headers.every((header) => !header)) {
      throw new ImportFileInvalidException(
        'The Excel file has no header row; the first row must contain column names',
      );
    }
    if (headers.some((header) => !header)) {
      throw new ImportFileInvalidException(
        'The Excel header row contains empty column names',
      );
    }
    assertUniqueHeaders(headers);

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
}

/**
 * Extracts a stable string from a cell: numbers and booleans keep their raw
 * value (no thousand separators), dates render as ISO yyyy-mm-dd.
 */
function cellToRawString(cell: Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    // exceljs 4.4 Cell.text renders Date values via raw JS Date.toString(),
    // ignoring the cell number format — unusable for imports. Emit the ISO
    // date part instead, which the row schemas can parse reliably.
    if (value instanceof Date) return formatIsoDate(value);
    if (
      'richText' in value &&
      Array.isArray((value as CellRichTextValue).richText)
    ) {
      return (value as CellRichTextValue).richText
        .map((part) => part.text)
        .join('');
    }
    return cell.text || '';
  }
  return String(value);
}

function formatIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
