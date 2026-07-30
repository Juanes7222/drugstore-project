import {
  ReportColumnType,
  type AnyReportRow,
  type ReportColumn,
} from './report-types';

const NUMERIC_COLUMN_TYPES = new Set<ReportColumnType>([
  ReportColumnType.INTEGER,
  ReportColumnType.NUMBER,
  ReportColumnType.CURRENCY,
  ReportColumnType.PERCENT,
]);

export function formatCell(
  row: AnyReportRow,
  column: ReportColumn,
  locale = 'es-CO',
): string {
  const raw = row[column.id];

  if (raw === null || raw === undefined) {
    return '';
  }

  switch (column.type) {
    case ReportColumnType.CURRENCY:
      return Number(raw).toLocaleString(locale, {
        style: 'currency',
        currency: 'COP',
        maximumFractionDigits: 0,
      });

    case ReportColumnType.PERCENT:
      return `${Number(raw).toFixed(2)}%`;

    case ReportColumnType.INTEGER:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 0,
      });

    case ReportColumnType.NUMBER:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 4,
      });

    case ReportColumnType.DATE:
    case ReportColumnType.DATETIME: {
      const date = new Date(raw as string);

      if (Number.isNaN(date.getTime())) {
        return String(raw);
      }

      return column.type === ReportColumnType.DATE
        ? date.toLocaleDateString(locale)
        : date.toLocaleString(locale);
    }

    default:
      return String(raw);
  }
}

export function formatPdfCell(
  row: AnyReportRow,
  column: ReportColumn,
  locale = 'es-CO',
): string {
  const raw = row[column.id];

  if (raw === null || raw === undefined) {
    return '';
  }

  switch (column.type) {
    case ReportColumnType.CURRENCY:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 0,
      });

    case ReportColumnType.PERCENT:
      return `${Number(raw).toFixed(2)}%`;

    case ReportColumnType.INTEGER:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 0,
      });

    case ReportColumnType.NUMBER:
      return Number(raw).toLocaleString(locale, {
        maximumFractionDigits: 4,
      });

    case ReportColumnType.DATE:
    case ReportColumnType.DATETIME: {
      const date = new Date(raw as string);

      if (Number.isNaN(date.getTime())) {
        return String(raw);
      }

      return column.type === ReportColumnType.DATE
        ? date.toLocaleDateString(locale)
        : date.toLocaleString(locale);
    }

    default:
      return String(raw);
  }
}

export function formatKpiValue(
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

export function toExcelValue(
  value: unknown,
  column: ReportColumn,
): string | number | Date {
  if (value === null || value === undefined) {
    return '';
  }

  switch (column.type) {
    case ReportColumnType.INTEGER:
    case ReportColumnType.NUMBER:
    case ReportColumnType.CURRENCY:
    case ReportColumnType.PERCENT:
      return Number(value);

    case ReportColumnType.DATE:
    case ReportColumnType.DATETIME: {
      const date = new Date(value as string);
      return Number.isNaN(date.getTime()) ? String(value) : date;
    }

    default:
      return String(value);
  }
}

export function isNumericColumn(column: ReportColumn): boolean {
  return NUMERIC_COLUMN_TYPES.has(column.type);
}

export function excelNumberFormat(column: ReportColumn): string {
  switch (column.type) {
    case ReportColumnType.CURRENCY:
      return '"$"#,##0;[Red]-"$"#,##0';

    case ReportColumnType.PERCENT:
      return '0.00"%"';

    case ReportColumnType.INTEGER:
      return '#,##0';

    case ReportColumnType.NUMBER:
      return '#,##0.####';

    case ReportColumnType.DATE:
      return 'dd/mm/yyyy';

    case ReportColumnType.DATETIME:
      return 'dd/mm/yyyy hh:mm';

    default:
      return 'General';
  }
}

export function calculateColumnWidth(
  header: string,
  rows: AnyReportRow[],
  column: ReportColumn,
): number {
  const widths: Partial<Record<ReportColumnType, number>> = {
    [ReportColumnType.INTEGER]: 14,
    [ReportColumnType.NUMBER]: 16,
    [ReportColumnType.CURRENCY]: 18,
    [ReportColumnType.PERCENT]: 12,
    [ReportColumnType.DATE]: 14,
    [ReportColumnType.DATETIME]: 20,
    [ReportColumnType.BADGE]: 16,
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

export function pdfColumnWidth(
  type: ReportColumnType,
): number | 'auto' {
  switch (type) {
    case ReportColumnType.INTEGER:
    case ReportColumnType.PERCENT:
      return 48;

    case ReportColumnType.NUMBER:
      return 58;

    case ReportColumnType.CURRENCY:
      return 66;

    case ReportColumnType.DATE:
      return 58;

    case ReportColumnType.DATETIME:
      return 78;

    case ReportColumnType.BADGE:
      return 60;

    default:
      return 'auto';
  }
}