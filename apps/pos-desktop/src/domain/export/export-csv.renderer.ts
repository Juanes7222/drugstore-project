/**
 * CSV renderer for generic export documents.
 *
 * UTF-8 BOM so Excel opens Spanish accented characters correctly;
 * `;` delimiter (es-CO spreadsheet convention); CRLF line endings;
 * RFC-4180 escaping.
 */

import {
  formatCell,
  resolveColumnHeader,
  type ExportColumn,
} from '../../common/export';
import type { ExportDocument } from './export.types';

const CSV_DELIMITER = ';';
const UTF8_BOM = '\uFEFF';

export function renderCsv(document: ExportDocument): string {
  const locale = document.locale ?? 'es-CO';

  const headers = document.columns
    .map((column) => escapeCsv(resolveColumnHeader(column, document.t)))
    .join(CSV_DELIMITER);

  const rows = document.rows.map((row) =>
    document.columns
      .map((column) => escapeCsv(formatCell(row, column, locale)))
      .join(CSV_DELIMITER),
  );

  return `${UTF8_BOM}${[headers, ...rows].join('\r\n')}`;
}

function escapeCsv(value: string): string {
  if (!/[;"\r\n]/u.test(value)) {
    return value;
  }

  return `"${value.replace(/"/gu, '""')}"`;
}

export type { ExportColumn };