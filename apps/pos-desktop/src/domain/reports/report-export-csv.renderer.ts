import { formatCell, tr } from '../../common/export';
import type { ExportInput } from './report-export.types';

const CSV_DELIMITER = ';';
const UTF8_BOM = '\uFEFF';

export function renderCsv(input: ExportInput): string {
  const locale = input.locale ?? 'es-CO';

  const headers = input.definition.columns
    .map((column) =>
      escapeCsv(tr(input.t, column.titleKey, column.titleKey)),
    )
    .join(CSV_DELIMITER);

  const rows = input.response.rows.map((row) =>
    input.definition.columns
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