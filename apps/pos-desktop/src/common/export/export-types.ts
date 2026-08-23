/**
 * Generic export primitives — column and format definitions shared by the
 * report pipeline and the data-export pipeline.
 *
 * `ExportColumn` is intentionally structural: the reports module defines its
 * own `ReportColumn` with the same shape, and any object with `id`,
 * `titleKey`, and `type` is accepted by the formatters below.
 */

export const ExportFormat = {
  PDF: 'pdf',
  EXCEL: 'excel',
  CSV: 'csv',
  PRINT: 'print',
} as const;

export type ExportFormat = (typeof ExportFormat)[keyof typeof ExportFormat];

export const ExportColumnType = {
  TEXT: 'text',
  NUMBER: 'number',
  CURRENCY: 'currency',
  PERCENT: 'percent',
  DATE: 'date',
  DATETIME: 'datetime',
  INTEGER: 'integer',
  BADGE: 'badge',
} as const;

export type ExportColumnType =
  (typeof ExportColumnType)[keyof typeof ExportColumnType];

export interface ExportColumn {
  /** Row key the value is read from. */
  id: string;
  /** i18n key for the header. */
  titleKey: string;
  type: ExportColumnType;
  /** Right-align numerics by default. */
  align?: 'left' | 'right' | 'center';
  /** Optional fixed width, in characters. */
  width?: number;
  /** When the cell value is an enum (BADGE columns), the i18n key prefix
   *  under which the raw value is translated (`${prefix}.${value}`). */
  badgeKeyPrefix?: string;
  /**
   * Literal header that bypasses i18n entirely.  Used when the exported
   * header must match an external contract byte-for-byte — e.g. the
   * canonical import-column labels, so an exported file round-trips
   * through the data-import pipeline.
   */
  header?: string;
}

/** Any row the generic formatters can read a column value from. */
export type ExportRow = Record<string, unknown>;

/** i18n translator signature accepted by the export pipeline. */
export type ExportTranslator = (
  key: string,
  options?: { defaultValue?: string },
) => string;