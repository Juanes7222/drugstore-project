// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  ImportSourceFormat: { CSV: 'CSV', XLSX: 'XLSX', JSON: 'JSON' },
}));

import { ImportSourceFormat } from '@pharmacy/database';
import { JsonSourceAdapter } from './json-source.adapter';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';

describe('JsonSourceAdapter', () => {
  const adapter = new JsonSourceAdapter();

  describe('parse', () => {
    it('exposes the JSON format', () => {
      expect(adapter.format).toBe(ImportSourceFormat.JSON);
    });

    it('parses an array of objects, unioning keys as headers', async () => {
      const buffer = Buffer.from(
        JSON.stringify([
          { internalCode: 'P-1', nombre: 'Aspirina' },
          { nombre: 'Ibuprofeno', extra: true },
        ]),
        'utf8',
      );

      const table = await adapter.parse(buffer);

      expect(table.headers).toEqual(['internalCode', 'nombre', 'extra']);
      expect(table.rows).toEqual([
        { internalCode: 'P-1', nombre: 'Aspirina', extra: '' },
        { internalCode: '', nombre: 'Ibuprofeno', extra: true },
      ]);
    });

    it('parses an object with headers and rows arrays', async () => {
      const buffer = Buffer.from(
        JSON.stringify({
          headers: ['a', 'b'],
          rows: [
            ['1', '2'],
            ['3', '4'],
          ],
        }),
        'utf8',
      );

      const table = await adapter.parse(buffer);

      expect(table.headers).toEqual(['a', 'b']);
      expect(table.rows).toEqual([
        { a: '1', b: '2' },
        { a: '3', b: '4' },
      ]);
    });

    it('trims header strings in the headers/rows shape', async () => {
      const buffer = Buffer.from(
        JSON.stringify({ headers: [' a ', 'b'], rows: [['1', '2']] }),
        'utf8',
      );

      const table = await adapter.parse(buffer);

      expect(table.headers).toEqual(['a', 'b']);
    });

    it('maps missing row cells to empty strings', async () => {
      const buffer = Buffer.from(
        JSON.stringify({ headers: ['a', 'b'], rows: [['1']] }),
        'utf8',
      );

      const table = await adapter.parse(buffer);

      expect(table.rows[0]).toEqual({ a: '1', b: '' });
    });

    it('keeps native JSON value types in cells', async () => {
      const buffer = Buffer.from(
        JSON.stringify({ headers: ['n', 's'], rows: [[42, 'x']] }),
        'utf8',
      );

      const table = await adapter.parse(buffer);

      expect(table.rows[0]).toEqual({ n: 42, s: 'x' });
    });

    it('throws ImportFileInvalidException for invalid JSON', async () => {
      await expect(adapter.parse(Buffer.from('{oops', 'utf8'))).rejects.toThrow(
        ImportFileInvalidException,
      );
    });

    it('throws ImportFileInvalidException for an empty object array', async () => {
      await expect(adapter.parse(Buffer.from('[]', 'utf8'))).rejects.toThrow(
        ImportFileInvalidException,
      );
    });

    it('throws ImportFileInvalidException when an array element is not an object', async () => {
      await expect(
        adapter.parse(Buffer.from('[1, 2]', 'utf8')),
      ).rejects.toThrow(ImportFileInvalidException);
    });

    it('throws ImportFileInvalidException for a top-level scalar', async () => {
      await expect(adapter.parse(Buffer.from('42', 'utf8'))).rejects.toThrow(
        ImportFileInvalidException,
      );
    });

    it('throws ImportFileInvalidException when rows elements are not arrays', async () => {
      const buffer = Buffer.from(
        JSON.stringify({ headers: ['a'], rows: [{ a: 1 }] }),
        'utf8',
      );

      await expect(adapter.parse(buffer)).rejects.toThrow(
        ImportFileInvalidException,
      );
    });

    it('throws ImportFileInvalidException for duplicate headers in headers/rows shape', async () => {
      const buffer = Buffer.from(
        JSON.stringify({ headers: ['a', 'a'], rows: [['1', '2']] }),
        'utf8',
      );

      await expect(adapter.parse(buffer)).rejects.toThrow(
        ImportFileInvalidException,
      );
    });
  });
});
