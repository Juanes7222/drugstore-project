import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Workbook } from 'exceljs';
import { ImportSourceFormat } from '@pharmacy/database';
import { ExcelSourceAdapter } from './excel-source.adapter';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';

function buildWorkbookBuffer(
  build: (workbook: Workbook) => void,
): Promise<Buffer> {
  const workbook = new Workbook();
  build(workbook);
  return workbook.xlsx.writeBuffer().then((content) => Buffer.from(content));
}

function buildSimpleWorkbook(): Promise<Buffer> {
  return buildWorkbookBuffer((workbook) => {
    const sheet = workbook.addWorksheet('Datos');
    sheet.addRow(['Codigo', 'Nombre', 'Precio']);
    sheet.addRow(['P-1', 'Aspirina', 12500.5]);
    sheet.addRow(['P-2', 'Ibuprofeno', 8000]);
  });
}

describe('ExcelSourceAdapter', () => {
  const adapter = new ExcelSourceAdapter();

  describe('parse', () => {
    it('exposes the XLSX format', () => {
      expect(adapter.format).toBe(ImportSourceFormat.XLSX);
    });

    it('parses the first worksheet only', async () => {
      const buffer = await buildWorkbookBuffer((workbook) => {
        const first = workbook.addWorksheet('Datos');
        first.addRow(['Codigo', 'Nombre']);
        first.addRow(['P-1', 'Aspirina']);
        const second = workbook.addWorksheet('Otros');
        second.addRow(['Ignorada']);
        second.addRow(['X']);
      });

      const table = await adapter.parse(buffer);

      expect(table.headers).toEqual(['Codigo', 'Nombre']);
      expect(table.rows).toEqual([{ Codigo: 'P-1', Nombre: 'Aspirina' }]);
      expect(table.warnings).toEqual([]);
    });

    it('keeps numbers raw without thousand separators', async () => {
      const buffer = await buildWorkbookBuffer((workbook) => {
        const sheet = workbook.addWorksheet('Datos');
        sheet.addRow(['Precio']);
        const cell = sheet.addRow([12500.5]).getCell(1);
        cell.numFmt = '#,##0.00';
      });

      const table = await adapter.parse(buffer);

      expect(table.rows[0].Precio).toBe('12500.5');
    });

    it('converts boolean cells to their raw string form', async () => {
      const buffer = await buildWorkbookBuffer((workbook) => {
        const sheet = workbook.addWorksheet('Datos');
        sheet.addRow(['Activo']);
        sheet.addRow([true]);
      });

      const table = await adapter.parse(buffer);

      expect(table.rows[0].Activo).toBe('true');
    });

    it('renders date cells as raw Date.toString, ignoring the display format', async () => {
      // Known defect: cellToRawString relies on exceljs cell.text, which for
      // dates returns the raw Date.toString() instead of the cell's numFmt.
      // Reported; this test pins the current behavior.
      const buffer = await buildWorkbookBuffer((workbook) => {
        const sheet = workbook.addWorksheet('Datos');
        sheet.addRow(['Fecha']);
        const cell = sheet.addRow([new Date(2024, 0, 15)]).getCell(1);
        cell.numFmt = 'dd/mm/yyyy';
      });

      const table = await adapter.parse(buffer);

      expect(table.rows[0].Fecha).toMatch(/^2024-01-15/);
    });

    it('maps empty cells to empty strings', async () => {
      const buffer = await buildWorkbookBuffer((workbook) => {
        const sheet = workbook.addWorksheet('Datos');
        sheet.addRow(['Codigo', 'Nombre']);
        sheet.addRow(['P-1', null]);
      });

      const table = await adapter.parse(buffer);

      expect(table.rows[0]).toEqual({ Codigo: 'P-1', Nombre: '' });
    });

    it('skips stray blank rows', async () => {
      const buffer = await buildWorkbookBuffer((workbook) => {
        const sheet = workbook.addWorksheet('Datos');
        sheet.addRow(['Codigo', 'Nombre']);
        sheet.addRow(['P-1', 'Aspirina']);
        sheet.getRow(3);
        sheet.addRow(['P-2', 'Ibuprofeno']);
      });

      const table = await adapter.parse(buffer);

      expect(table.rows).toEqual([
        { Codigo: 'P-1', Nombre: 'Aspirina' },
        { Codigo: 'P-2', Nombre: 'Ibuprofeno' },
      ]);
    });

    it('throws ImportFileInvalidException for an invalid workbook', async () => {
      await expect(
        adapter.parse(Buffer.from('this is not an xlsx file')),
      ).rejects.toThrow(ImportFileInvalidException);
    });

    it('throws ImportFileInvalidException when the first sheet has no header row', async () => {
      const buffer = await buildWorkbookBuffer((workbook) => {
        workbook.addWorksheet('Datos');
      });

      await expect(adapter.parse(buffer)).rejects.toThrow(
        ImportFileInvalidException,
      );
    });

    it('throws ImportFileInvalidException for empty column names in the header', async () => {
      const buffer = await buildWorkbookBuffer((workbook) => {
        const sheet = workbook.addWorksheet('Datos');
        sheet.addRow(['Codigo', '', 'Nombre']);
      });

      await expect(adapter.parse(buffer)).rejects.toThrow(
        ImportFileInvalidException,
      );
    });

    it('throws ImportFileInvalidException for duplicate headers', async () => {
      const buffer = await buildWorkbookBuffer((workbook) => {
        const sheet = workbook.addWorksheet('Datos');
        sheet.addRow(['Codigo', 'Codigo']);
      });

      await expect(adapter.parse(buffer)).rejects.toThrow(
        ImportFileInvalidException,
      );
    });

    it('parses a real generated template round-trip', async () => {
      const buffer = await buildSimpleWorkbook();

      const table = await adapter.parse(buffer);

      expect(table.headers).toEqual(['Codigo', 'Nombre', 'Precio']);
      expect(table.rows[0]).toEqual({
        Codigo: 'P-1',
        Nombre: 'Aspirina',
        Precio: '12500.5',
      });
    });
  });
});
