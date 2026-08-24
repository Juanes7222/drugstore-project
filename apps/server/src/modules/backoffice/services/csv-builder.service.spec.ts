import { describe, it, expect } from '@jest/globals';

import { CsvBuilderService } from './csv-builder.service';

describe('CsvBuilderService', () => {
  const builder = new CsvBuilderService();

  describe('escapeCell', () => {
    it('leaves plain values untouched', () => {
      expect(builder.escapeCell('Dolex 500mg')).toBe('Dolex 500mg');
    });

    it('wraps cells containing the delimiter in quotes', () => {
      expect(builder.escapeCell('Acme, S.A.')).toBe('"Acme, S.A."');
    });

    it('doubles embedded quotes and wraps the cell', () => {
      expect(builder.escapeCell('say "hi"')).toBe('"say ""hi"""');
    });

    it('wraps cells containing line breaks', () => {
      expect(builder.escapeCell('line1\nline2')).toBe('"line1\nline2"');
      expect(builder.escapeCell('line1\r\nline2')).toBe('"line1\r\nline2"');
    });
  });

  describe('buildCsv', () => {
    it('prefixes a UTF-8 BOM and joins cells and lines with CRLF', () => {
      const csv = builder.buildCsv(['A', 'B'], [['1', '2'], ['3', '4']]);

      expect(csv).toBe('\uFEFFA,B\r\n1,2\r\n3,4\r\n');
    });

    it('escapes every data cell but still escapes header cells too', () => {
      const csv = builder.buildCsv(
        ['Nombre', 'Nota'],
        [['Ana', 'con, coma']],
      );

      expect(csv).toBe('\uFEFFNombre,Nota\r\nAna,"con, coma"\r\n');
    });
  });

  describe('formatDateTime', () => {
    it('formats as UTC YYYY-MM-DD HH:mm with zero padding', () => {
      expect(builder.formatDateTime(new Date(Date.UTC(2026, 2, 5, 9, 7)))).toBe(
        '2026-03-05 09:07',
      );
    });

    it('returns an empty string for null', () => {
      expect(builder.formatDateTime(null)).toBe('');
    });
  });

  describe('exportFileStamp', () => {
    it('builds a padded YYYYMMDD-HHmm stamp in UTC', () => {
      expect(builder.exportFileStamp(new Date(Date.UTC(2026, 3, 17, 8, 5)))).toBe(
        '20260417-0805',
      );
    });

    it('defaults to the current time when no date is given', () => {
      expect(builder.exportFileStamp()).toMatch(/^\d{8}-\d{4}$/);
    });
  });
});
