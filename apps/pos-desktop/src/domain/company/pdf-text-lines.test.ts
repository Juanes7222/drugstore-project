/**
 * Unit tests for the pdf.js text-item line reconstructor used by the RUT
 * extractor: items are grouped into visual rows by Y position, ordered
 * left-to-right inside each row, and rows are emitted top-down.
 */
import { describe, expect, it } from 'vitest';
import { buildTextLines, type PdfTextItem } from './pdf-text-lines';

/** Synthetic text item with a translation-only pdf.js transform. */
function item(str: string, x: number, y: number): PdfTextItem {
  return { str, transform: [1, 0, 0, 1, x, y] };
}

describe('buildTextLines', () => {
  it('joins items on the same row into one left-to-right line', () => {
    const lines = buildTextLines([
      item('MEDELLÍN', 120, 100),
      item('COLOMBIA', 40, 100),
      item('ANTIOQUIA', 80, 100),
    ]);

    expect(lines).toEqual(['COLOMBIA ANTIOQUIA MEDELLÍN']);
  });

  it('groups slightly offset items with the row they visually belong to', () => {
    // Sub-tolerance Y jitter must not split a visual row; the row keeps
    // its top-down (Y-descending) item order.
    const lines = buildTextLines([
      item('MEDELLÍN', 120, 100),
      item('COLOMBIA', 40, 100.5),
      item('ANTIOQUIA', 200, 99),
    ]);

    expect(lines).toEqual(['COLOMBIA MEDELLÍN ANTIOQUIA']);
  });

  it('keeps an item exactly at the tolerance boundary on the same line', () => {
    const lines = buildTextLines([item('CL', 10, 103), item('45 B', 30, 100)]);

    expect(lines).toEqual(['CL 45 B']);
  });

  it('starts a new line when items are more than the tolerance apart', () => {
    const lines = buildTextLines([item('CL', 10, 103.5), item('45 B', 30, 100)]);

    expect(lines).toEqual(['CL', '45 B']);
  });

  it('orders lines top-down regardless of input order', () => {
    const lines = buildTextLines([
      item('low row', 10, 50),
      item('high row', 10, 200),
    ]);

    expect(lines).toEqual(['high row', 'low row']);
  });

  it('drops empty and whitespace-only items', () => {
    const lines = buildTextLines([
      item('', 5, 100),
      item('   ', 15, 100),
      item('CL', 25, 100),
    ]);

    expect(lines).toEqual(['CL']);
  });

  it('collapses extra whitespace when joining a line', () => {
    const lines = buildTextLines([
      item(' CL  45 ', 10, 100),
      item('B # 12-34', 60, 100),
    ]);

    expect(lines).toEqual(['CL 45 B # 12-34']);
  });

  it('returns an empty array for empty or blank input', () => {
    expect(buildTextLines([])).toEqual([]);
    expect(buildTextLines([item(' ', 0, 10), item('', 5, 20)])).toEqual([]);
  });
});
