import Papa from 'papaparse';
import { ImportSourceFormat } from '@pharmacy/database';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';
import {
  ImportSourceAdapter,
  ParsedImportTable,
  assertUniqueHeaders,
  decodeTextBuffer,
} from './import-source.adapter';

export class CsvSourceAdapter implements ImportSourceAdapter {
  readonly format = ImportSourceFormat.CSV;

  async parse(buffer: Buffer): Promise<ParsedImportTable> {
    const text = decodeTextBuffer(buffer);
    if (!text.trim()) {
      throw new ImportFileInvalidException('The CSV file is empty');
    }

    const result = Papa.parse<string[]>(text, {
      skipEmptyLines: 'greedy',
      // Cells stay strings; conversion happens in the definition schemas.
      dynamicTyping: false,
    });

    const rows = result.data;
    const headerRow = rows[0];
    if (!headerRow || headerRow.every((cell) => !cell.trim())) {
      throw new ImportFileInvalidException(
        'The CSV file has no header row; the first row must contain column names',
      );
    }

    const headers = headerRow.map((cell) => cell.trim());
    if (headers.some((header) => !header)) {
      throw new ImportFileInvalidException(
        'The CSV header row contains empty column names',
      );
    }
    assertUniqueHeaders(headers);

    return {
      headers,
      rows: rows.slice(1).map((row) => {
        const record: Record<string, unknown> = {};
        headers.forEach((header, index) => {
          record[header] = row[index] ?? '';
        });
        return record;
      }),
      warnings: result.errors.map(
        (error) => `CSV parse issue: ${error.message}`,
      ),
    };
  }
}
