/**
 * Shared cell formatters for export documents (CSV, Excel, PDF, print).
 *
 * These are the single place where raw row values become locale-aware
 * display strings or typed Excel/PDF cell values.  Works structurally with
 * both `ExportColumn` and the reports module's `ReportColumn` (same shape).
 */

import {
  ExportColumnType,
  type ExportColumn,
  type ExportRow,
  type ExportTranslator,
} from './export-types';
import { tr } from './export-i18n';

const NUMERIC_COLUMN_TYPES = new Set<ExportColumnType>([
  ExportColumnType.INTEGER,
  ExportColumnType.NUMBER,
  ExportColumnType.CURRENCY,
  ExportColumnType.PERCENT,
]);

/**
 * Resolve a column's display header.
 *
 * A literal `header` wins over i18n (contract headers must round-trip
 * unchanged); otherwise the `titleKey` is translated with the key itself
 * as fallback.
 */
export function resolveColumnHeader(
  column: ExportColumn,
  translator?: ExportTranslator,
): string {
  if (column.header !== undefined) {
    return column.header;
  }
  return tr(translator, column.titleKey, column.titleKey);
}

/** Locale-aware display string for CSV / print rendering. */
export function formatCell(
  row: ExportRow,
  column: ExportColumn,
  locale = 'es-CO',
): string {
  const raw = row[column.id];

  if (raw === null || raw === undefined) {
    return '';
  }

  switch (column.type) {
    case ExportColumnType.CURRENCY:
      return Number(raw).toLocaleString(locale, {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      });

    case ExportColumnType.PERCENT:
      return `${Number(raw).toFixed(2)}%`;

    case ExportColumnType.INTEGER:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 0,
      });

    case ExportColumnType.NUMBER:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 4,
      });

    case ExportColumnType.DATE:
    case ExportColumnType.DATETIME: {
      const date = new Date(raw as string);

      if (Number.isNaN(date.getTime())) {
        return String(raw);
      }

      return column.type === ExportColumnType.DATE
        ? date.toLocaleDateString(locale)
        : date.toLocaleString(locale);
    }

    default:
      return String(raw);
  }
}

/** PDF-specific display string (no currency symbol, keeps digits readable). */
export function formatPdfCell(
  row: ExportRow,
  column: ExportColumn,
  locale = 'es-CO',
): string {
  const raw = row[column.id];

  if (raw === null || raw === undefined) {
    return '';
  }

  switch (column.type) {
    case ExportColumnType.CURRENCY:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 0,
      });

    case ExportColumnType.PERCENT:
      return `${Number(raw).toFixed(2)}%`;

    case ExportColumnType.INTEGER:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 0,
      });

    case ExportColumnType.NUMBER:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 4,
      });

    case ExportColumnType.DATE:
    case ExportColumnType.DATETIME: {
      const date = new Date(raw as string);

      if (Number.isNaN(date.getTime())) {
        return String(raw);
      }

      return column.type === ExportColumnType.DATE
        ? date.toLocaleDateString(locale)
        : date.toLocaleString(locale);
    }

    default:
      return String(raw);
  }
}

/** Raw KPI/stat value as a display string. */
export function formatStatValue(
  value: string | number | null | undefined,
  locale = 'es-CO',
): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return value.toLocaleString(locale, {
      maximumFractionDigits: 4,
    });
  }

  return String(value);
}

/** Typed cell value for Excel: numbers stay numbers, dates become Dates. */
export function toExcelValue(
  value: unknown,
  column: ExportColumn,
): string | number | Date {
  if (value === null || value === undefined) {
    return '';
  }

  switch (column.type) {
    case ExportColumnType.INTEGER:
    case ExportColumnType.NUMBER:
    case ExportColumnType.CURRENCY:
    case ExportColumnType.PERCENT:
      return Number(value);

    case ExportColumnType.DATE:
    case ExportColumnType.DATETIME: {
      const date = new Date(value as string);
      return Number.isNaN(date.getTime()) ? String(value) : date;
    }

    default:
      return String(value);
  }
}

export function isNumericColumn(column: ExportColumn): boolean {
  return NUMERIC_COLUMN_TYPES.has(column.type);
}

export function excelNumberFormat(column: ExportColumn): string {
  switch (column.type) {
    case ExportColumnType.CURRENCY:
      return '"$"#,##0;[Red]-"$"#,##0';

    case ExportColumnType.PERCENT:
      return '0.00"%"';

    case ExportColumnType.INTEGER:
      return '#,##0';

    case ExportColumnType.NUMBER:
      return '#,##0.####';

    case ExportColumnType.DATE:
      return 'dd/mm/yyyy';

    case ExportColumnType.DATETIME:
      return 'dd/mm/yyyy hh:mm';

    default:
      return 'General';
  }
}

export function calculateColumnWidth(
  header: string,
  rows: readonly ExportRow[],
  column: ExportColumn,
): number {
  const widths: Partial<Record<ExportColumnType, number>> = {
    [ExportColumnType.INTEGER]: 14,
    [ExportColumnType.NUMBER]: 16,
    [ExportColumnType.CURRENCY]: 18,
    [ExportColumnType.PERCENT]: 12,
    [ExportColumnType.DATE]: 14,
    [ExportColumnType.DATETIME]: 20,
    [ExportColumnType.BADGE]: 16,
  };

  const maxLength = rows.reduce((max, row) => {
    const value = row[column.id];
    return Math.max(
      max,
      value === null || value === undefined ? 0 : String(value).length,
    );
  }, header.length);

  return Math.min(Math.max(widths[column.type] ?? 20, maxLength + 2), 42);
}

export function pdfColumnWidth(type: ExportColumnType): number | 'auto' {
  switch (type) {
    case ExportColumnType.INTEGER:
    case ExportColumnType.PERCENT:
      return 48;

    case ExportColumnType.NUMBER:
      return 58;

    case ExportColumnType.CURRENCY:
      return 66;

    case ExportColumnType.DATE:
      return 58;

    case ExportColumnType.DATETIME:
      return 78;

    case ExportColumnType.BADGE:
      return 60;

    default:
      return 'auto';
  }
}