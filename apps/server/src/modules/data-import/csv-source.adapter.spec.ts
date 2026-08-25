import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { ImportSourceFormat } from '@pharmacy/database';
import { CsvSourceAdapter } from './csv-source.adapter';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';

describe('CsvSourceAdapter', () => {
  const adapter = new CsvSourceAdapter();

  describe('parse', () => {
    it('exposes the CSV format', () => {
      expect(adapter.format).toBe(ImportSourceFormat.CSV);
    });

    it('parses headers and rows with an auto-detected delimiter', async () => {
      const buffer = Buffer.from(
        'Codigo interno;Nombre\nP-1;Aspirina\nP-2;Ibuprofeno\n',
        'utf8',
      );

      const table = await adapter.parse(buffer);

      expect(table.headers).toEqual(['Codigo interno', 'Nombre']);
      expect(table.rows).toEqual([
        { 'Codigo interno': 'P-1', Nombre: 'Aspirina' },
        { 'Codigo interno': 'P-2', Nombre: 'Ibuprofeno' },
      ]);
      expect(table.warnings).toEqual([]);
    });

    it('strips a UTF-8 BOM and keeps accented headers', async () => {
      const buffer = Buffer.from(
        '\uFEFFCódigo;Nombre comercial\nP-1;Aspirina\n',
        'utf8',
      );

      const table = await adapter.parse(buffer);

      expect(table.headers).toEqual(['Código', 'Nombre comercial']);
      expect(table.rows[0]['Nombre comercial']).toBe('Aspirina');
    });

    it('falls back to Latin-1 for Windows Excel exports without a BOM', async () => {
      const buffer = Buffer.from([
        0x43, 0x3b, 0x4e, 0x6f, 0x6d, 0x62, 0x72, 0x65, 0x20, 0xe9, 0x0a, 0x50,
        0x2d, 0x31, 0x3b, 0x41, 0x0a,
      ]);

      const table = await adapter.parse(buffer);

      expect(table.headers).toEqual(['C', 'Nombre é']);
      expect(table.rows[0]).toEqual({ C: 'P-1', 'Nombre é': 'A' });
    });

    it('trims header cells', async () => {
      const buffer = Buffer.from('  Codigo  ;Nombre \nP-1;A\n', 'utf8');

      const table = await adapter.parse(buffer);

      expect(table.headers).toEqual(['Codigo', 'Nombre']);
    });

    it('keeps cell values as strings without dynamic typing', async () => {
      const buffer = Buffer.from('precio\n12500.50\n', 'utf8');

      const table = await adapter.parse(buffer);

      expect(table.rows[0].precio).toBe('12500.50');
    });

    it('maps missing trailing cells to empty strings', async () => {
      const buffer = Buffer.from('a,b\n1\n', 'utf8');

      const table = await adapter.parse(buffer);

      expect(table.rows[0]).toEqual({ a: '1', b: '' });
    });

    it('skips fully empty lines', async () => {
      const buffer = Buffer.from('a;b\n1;2\n\n\n3;4\n', 'utf8');

      const table = await adapter.parse(buffer);

      expect(table.rows).toEqual([
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ]);
    });

    it('throws ImportFileInvalidException for an empty file', async () => {
      await expect(adapter.parse(Buffer.alloc(0))).rejects.toThrow(
        ImportFileInvalidException,
      );
    });

    it('throws ImportFileInvalidException for a whitespace-only file', async () => {
      await expect(
        adapter.parse(Buffer.from('   \n\n', 'utf8')),
      ).rejects.toThrow(ImportFileInvalidException);
    });

    it('throws ImportFileInvalidException when no header row exists', async () => {
      await expect(
        adapter.parse(Buffer.from('\n\n\n', 'utf8')),
      ).rejects.toThrow(ImportFileInvalidException);
    });

    it('throws ImportFileInvalidException for empty column names in the header', async () => {
      await expect(
        adapter.parse(Buffer.from('a;;b\n1;2;3\n', 'utf8')),
      ).rejects.toThrow(ImportFileInvalidException);
    });

    it('throws ImportFileInvalidException for duplicate headers', async () => {
      await expect(
        adapter.parse(Buffer.from('a;a\n1;2\n', 'utf8')),
      ).rejects.toThrow(ImportFileInvalidException);
    });
  });
});
