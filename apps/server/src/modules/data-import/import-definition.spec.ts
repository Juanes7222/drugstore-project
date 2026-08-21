import { z } from 'zod';
import {
  PRODUCT_IMPORT_COLUMNS,
  CLIENT_IMPORT_COLUMNS,
} from '@pharmacy/shared-validation';
import {
  buildAliasMap,
  missingRequiredHeaders,
  normalizeCellValue,
  normalizeHeader,
  zodIssuesToImportIssues,
} from './import-definition';

describe('normalizeHeader', () => {
  it('lowercases and trims', () => {
    expect(normalizeHeader('  Nombre Comercial ')).toBe('nombre comercial');
  });

  it('folds accents', () => {
    expect(normalizeHeader('Código')).toBe('codigo');
    expect(normalizeHeader('Concentración')).toBe('concentracion');
    expect(normalizeHeader('Número de Documento')).toBe('numero de documento');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeHeader('  Tipo   de   Venta ')).toBe('tipo de venta');
  });
});

describe('normalizeCellValue', () => {
  it('trims string values', () => {
    expect(normalizeCellValue('  Aspirina  ')).toBe('Aspirina');
  });

  it('maps empty strings to undefined', () => {
    expect(normalizeCellValue('')).toBeUndefined();
  });

  it('maps placeholder aliases to undefined', () => {
    expect(normalizeCellValue('-')).toBeUndefined();
    expect(normalizeCellValue('n/a')).toBeUndefined();
    expect(normalizeCellValue('N/A')).toBeUndefined();
    expect(normalizeCellValue('null')).toBeUndefined();
    expect(normalizeCellValue('undefined')).toBeUndefined();
  });

  it('passes non-string values through unchanged', () => {
    expect(normalizeCellValue(42)).toBe(42);
    expect(normalizeCellValue(null)).toBeNull();
    expect(normalizeCellValue(undefined)).toBeUndefined();
    expect(normalizeCellValue(true)).toBe(true);
  });
});

describe('buildAliasMap', () => {
  const map = buildAliasMap(PRODUCT_IMPORT_COLUMNS);

  it('maps canonical keys to themselves', () => {
    // Canonical keys are stored normalized (lowercased), matching the
    // normalizeHeader lookup that mapColumns performs.
    expect(map.get('internalcode')).toBe('internalCode');
    expect(map.get('initialprice')).toBe('initialPrice');
  });

  it('maps accented Spanish aliases to canonical keys', () => {
    expect(map.get('codigo')).toBe('internalCode');
    expect(map.get('nombre comercial')).toBe('commercialName');
    expect(map.get('precio de venta')).toBe('initialPrice');
  });

  it('maps English aliases to canonical keys', () => {
    expect(map.get('internal_code')).toBe('internalCode');
    expect(map.get('sale type')).toBe('saleType');
  });

  it('returns undefined for unknown headers', () => {
    expect(map.get('columna inexistente')).toBeUndefined();
  });

  it('keeps only one entry when aliases collide', () => {
    const clientMap = buildAliasMap(CLIENT_IMPORT_COLUMNS);

    expect(clientMap.get('nombre')).toBe('fullName');
  });
});

describe('missingRequiredHeaders', () => {
  it('returns empty when every required column is present', () => {
    const headers = [
      'Codigo interno',
      'Nombre comercial',
      'Laboratorio',
      'Precio de venta',
      'Impuesto',
    ];

    expect(missingRequiredHeaders(PRODUCT_IMPORT_COLUMNS, headers)).toEqual([]);
  });

  it('accepts aliases for required columns', () => {
    const headers = ['codigo', 'nombre', 'lab', 'precio', 'iva'];

    expect(missingRequiredHeaders(PRODUCT_IMPORT_COLUMNS, headers)).toEqual([]);
  });

  it('accepts accented header variants', () => {
    const headers = [
      'Código',
      'Nombre Comercial',
      'Laboratorio',
      'Precio',
      'IVA',
    ];

    expect(missingRequiredHeaders(PRODUCT_IMPORT_COLUMNS, headers)).toEqual([]);
  });

  it('lists labels of missing required columns', () => {
    const headers = ['Nombre comercial', 'Laboratorio', 'Precio de venta'];

    expect(missingRequiredHeaders(PRODUCT_IMPORT_COLUMNS, headers)).toEqual([
      'Codigo interno',
      'Impuesto',
    ]);
  });

  it('reports missing client required columns by label', () => {
    const headers = ['Nombre completo'];

    expect(missingRequiredHeaders(CLIENT_IMPORT_COLUMNS, headers)).toEqual([
      'Tipo de documento',
      'Numero de documento',
    ]);
  });
});

describe('zodIssuesToImportIssues', () => {
  it('maps a field-level issue to path and message', () => {
    const error = z
      .object({ internalCode: z.string().min(1) })
      .safeParse({ internalCode: '' });
    if (error.success) fail('expected a ZodError');

    const issues = zodIssuesToImportIssues(error.error);

    expect(issues).toEqual([
      { path: 'internalCode', message: expect.any(String) },
    ]);
  });

  it('maps a nested path joining segments with dots', () => {
    const error = z
      .object({ data: z.object({ price: z.number() }) })
      .safeParse({ data: { price: 'x' } });
    if (error.success) fail('expected a ZodError');

    const issues = zodIssuesToImportIssues(error.error);

    expect(issues).toEqual([
      { path: 'data.price', message: expect.any(String) },
    ]);
  });

  it('uses "row" as the path for issues without a field path', () => {
    const error = z.string().safeParse(42);
    if (error.success) fail('expected a ZodError');

    const issues = zodIssuesToImportIssues(error.error);

    expect(issues).toEqual([{ path: 'row', message: expect.any(String) }]);
  });
});
