import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { ImportSourceFormat } from '@pharmacy/database';
import {
  assertUniqueHeaders,
  decodeTextBuffer,
  detectImportFormat,
} from './import-source.adapter';
import { ImportFileInvalidException } from './exceptions/import-file-invalid.exception';

describe('detectImportFormat', () => {
  it('resolves CSV from a .csv extension', () => {
    expect(detectImportFormat('products.csv', Buffer.from('a,b'))).toBe(
      ImportSourceFormat.CSV,
    );
  });

  it('resolves CSV from a .txt extension', () => {
    expect(detectImportFormat('products.txt', Buffer.from('a,b'))).toBe(
      ImportSourceFormat.CSV,
    );
  });

  it('resolves XLSX from a .xlsx extension', () => {
    expect(detectImportFormat('products.xlsx', Buffer.from('nope'))).toBe(
      ImportSourceFormat.XLSX,
    );
  });

  it('resolves XLSX from a .xls extension', () => {
    expect(detectImportFormat('products.xls', Buffer.from('nope'))).toBe(
      ImportSourceFormat.XLSX,
    );
  });

  it('resolves JSON from a .json extension', () => {
    expect(detectImportFormat('products.json', Buffer.from('nope'))).toBe(
      ImportSourceFormat.JSON,
    );
  });

  it('is case-insensitive on the extension', () => {
    expect(detectImportFormat('PRODUCTS.CSV', Buffer.from('a,b'))).toBe(
      ImportSourceFormat.CSV,
    );
  });

  it('sniffs the PK zip signature as XLSX when the extension is unknown', () => {
    const buffer = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);

    expect(detectImportFormat('upload', buffer)).toBe(ImportSourceFormat.XLSX);
  });

  it('sniffs a leading { as JSON when the extension is unknown', () => {
    expect(detectImportFormat('upload', Buffer.from('{"a":1}'))).toBe(
      ImportSourceFormat.JSON,
    );
  });

  it('sniffs a leading [ as JSON when the extension is unknown', () => {
    expect(detectImportFormat('upload', Buffer.from('[1,2]'))).toBe(
      ImportSourceFormat.JSON,
    );
  });

  it('defaults to CSV when the extension is unknown and no signature matches', () => {
    expect(detectImportFormat('upload', Buffer.from('a,b'))).toBe(
      ImportSourceFormat.CSV,
    );
  });

  it('defaults to CSV for an empty buffer', () => {
    expect(detectImportFormat('upload', Buffer.alloc(0))).toBe(
      ImportSourceFormat.CSV,
    );
  });
});

describe('decodeTextBuffer', () => {
  it('decodes valid UTF-8 text', () => {
    expect(decodeTextBuffer(Buffer.from('Código,Nombre', 'utf8'))).toBe(
      'Código,Nombre',
    );
  });

  it('strips a UTF-8 BOM', () => {
    expect(decodeTextBuffer(Buffer.from('\uFEFFa,b', 'utf8'))).toBe('a,b');
  });

  it('falls back to Latin-1 when the buffer is not valid UTF-8', () => {
    const buffer = Buffer.from([0x63, 0x3b, 0xe9]);

    expect(decodeTextBuffer(buffer)).toBe('c;é');
  });
});

describe('assertUniqueHeaders', () => {
  it('does not throw for unique headers', () => {
    expect(() => assertUniqueHeaders(['a', 'b', 'c'])).not.toThrow();
  });

  it('throws ImportFileInvalidException for duplicate headers', () => {
    expect(() => assertUniqueHeaders(['a', 'b', 'a'])).toThrow(
      ImportFileInvalidException,
    );
  });

  it('lists each duplicated header once', () => {
    try {
      assertUniqueHeaders(['a', 'b', 'a', 'c', 'b']);
      fail('expected assertUniqueHeaders to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportFileInvalidException);
      expect((error as Error).message).toBe(
        'Duplicate column headers are not allowed: a, b',
      );
    }
  });

  it('ignores empty headers when detecting duplicates', () => {
    expect(() => assertUniqueHeaders(['', 'a', ''])).not.toThrow();
  });
});
