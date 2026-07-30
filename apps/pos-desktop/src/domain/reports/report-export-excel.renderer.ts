import ExcelJS from 'exceljs';
import { getTenantInfo } from '../configuration/local-config.store';
import type { ExportInput } from './report-export.types';
import {
  calculateColumnWidth,
  excelNumberFormat,
  formatKpiValue,
  isNumericColumn,
  toExcelValue,
} from './report-export-formatters';
import { tr } from './report-export-i18n';
import { REPORT_THEME, hexToArgb } from './report-export-theme';

export async function renderExcel(
  input: ExportInput,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = input.userDisplayName;
  workbook.created = new Date(input.response.generatedAt);
  workbook.modified = new Date();

  const summary = workbook.addWorksheet(
    tr(input.t, 'reports.export.summarySheet', 'Summary'),
    {
      views: [{ showGridLines: false }],
      pageSetup: {
        orientation: 'portrait',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    },
  );

  const detail = workbook.addWorksheet(
    tr(input.t, 'reports.export.detailSheet', 'Detail'),
    {
      views: [
        {
          state: 'frozen',
          ySplit: 1,
          showGridLines: false,
        },
      ],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    },
  );

  const filters = workbook.addWorksheet(
    tr(input.t, 'reports.export.filtersSheet', 'Filters'),
    {
      views: [{ showGridLines: false }],
      pageSetup: {
        orientation: 'portrait',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    },
  );

  buildSummarySheet(summary, input);
  buildDetailSheet(detail, input);
  buildFiltersSheet(filters, input);

  return workbook.xlsx.writeBuffer();
}

function buildSummarySheet(
  sheet: ExcelJS.Worksheet,
  input: ExportInput,
): void {
  const tenant = getTenantInfo();
  const locale = input.locale ?? 'es-CO';

  sheet.columns = Array.from({ length: 8 }, () => ({ width: 18 }));

  sheet.mergeCells('A1:H1');
  sheet.mergeCells('A2:H2');

  const title = sheet.getCell('A1');
  title.value = tenant.name;
  title.font = {
    name: REPORT_THEME.fonts.ui,
    size: 18,
    bold: true,
    color: { argb: hexToArgb(REPORT_THEME.colors.panel) },
  };
  title.fill = fill(REPORT_THEME.colors.pharma);
  title.alignment = { horizontal: 'left', vertical: 'middle' };

  const subtitle = sheet.getCell('A2');
  subtitle.value = input.definition.code;
  subtitle.font = {
    name: REPORT_THEME.fonts.ui,
    size: 11,
    bold: true,
    color: { argb: hexToArgb(REPORT_THEME.colors.ink) },
  };
  subtitle.fill = fill(REPORT_THEME.colors.surface);
  subtitle.alignment = { horizontal: 'left', vertical: 'middle' };

  sheet.getRow(1).height = 30;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 8;

  addMetaCard(
    sheet,
    'A4:D6',
    tr(input.t, 'reports.export.period', 'Period'),
    `${input.response.filters.dateFrom} — ${input.response.filters.dateTo}`,
  );

  addMetaCard(
    sheet,
    'E4:H6',
    tr(input.t, 'reports.export.generatedAt', 'Generated'),
    new Date(input.response.generatedAt).toLocaleString(locale),
  );

  addMetaCard(
    sheet,
    'A7:D9',
    tr(input.t, 'reports.export.user', 'User'),
    input.userDisplayName,
  );

  addMetaCard(
    sheet,
    'E7:H9',
    tr(input.t, 'reports.export.source', 'Source'),
    tr(
      input.t,
      'reports.export.localSource',
      'Local workstation database',
    ),
  );

  sheet.getRow(10).height = 8;
  sheet.mergeCells('A11:H11');

  const heading = sheet.getCell('A11');
  heading.value = tr(input.t, 'reports.export.indicators', 'Indicators');
  heading.font = {
    name: REPORT_THEME.fonts.ui,
    size: 11,
    bold: true,
    color: { argb: hexToArgb(REPORT_THEME.colors.ink) },
  };
  heading.fill = fill(REPORT_THEME.colors.surface);
  heading.alignment = { vertical: 'middle' };

  sheet.getRow(11).height = 22;

  input.response.kpis.forEach((kpi, index) => {
    const baseRow = 12 + Math.floor(index / 2) * 4;
    const startColumn = index % 2 === 0 ? 'A' : 'E';
    const endColumn = index % 2 === 0 ? 'D' : 'H';

    sheet.mergeCells(`${startColumn}${baseRow}:${endColumn}${baseRow}`);
    sheet.mergeCells(
      `${startColumn}${baseRow + 1}:${endColumn}${baseRow + 2}`,
    );

    const label = sheet.getCell(`${startColumn}${baseRow}`);
    label.value = tr(input.t, kpi.titleKey, kpi.titleKey).toUpperCase();
    label.font = {
      name: REPORT_THEME.fonts.ui,
      size: 8,
      bold: true,
      color: { argb: hexToArgb(REPORT_THEME.colors.inkMuted) },
    };
    label.fill = fill(REPORT_THEME.colors.panel);

    const value = sheet.getCell(`${startColumn}${baseRow + 1}`);
    value.value = formatKpiValue(kpi.value, locale);
    value.font = {
      name: REPORT_THEME.fonts.data,
      size: 15,
      bold: true,
      color: { argb: hexToArgb(REPORT_THEME.colors.pharma) },
    };
    value.fill = fill(REPORT_THEME.colors.panel);
    value.alignment = { vertical: 'middle' };

    applyRangeBorder(
      sheet,
      `${startColumn}${baseRow}:${endColumn}${baseRow + 2}`,
    );
  });
}

function buildDetailSheet(
  sheet: ExcelJS.Worksheet,
  input: ExportInput,
): void {
  const headers = input.definition.columns.map((column) =>
    tr(input.t, column.titleKey, column.titleKey),
  );

  sheet.columns = input.definition.columns.map((column, index) => ({
    key: column.id,
    width: calculateColumnWidth(
      headers[index],
      input.response.rows,
      column,
    ),
  }));

  const headerRow = sheet.getRow(1);
  headerRow.values = headers;
  headerRow.height = 28;

  headerRow.eachCell((cell) => {
    cell.font = {
      name: REPORT_THEME.fonts.ui,
      size: 9,
      bold: true,
      color: { argb: hexToArgb(REPORT_THEME.colors.panel) },
    };
    cell.fill = fill(REPORT_THEME.colors.pharma);
    cell.alignment = {
      horizontal: 'center',
      vertical: 'middle',
      wrapText: true,
    };
    cell.border = {
      bottom: {
        style: 'thin',
        color: { argb: hexToArgb(REPORT_THEME.colors.pharma) },
      },
    };
  });

  input.response.rows.forEach((sourceRow) => {
    const row = sheet.addRow(
      input.definition.columns.map((column) =>
        toExcelValue(sourceRow[column.id], column),
      ),
    );

    row.height = 20;

    row.eachCell((cell, columnIndex) => {
      const column = input.definition.columns[columnIndex - 1];
      const numeric = isNumericColumn(column);

      cell.font = {
        name: numeric ? REPORT_THEME.fonts.data : REPORT_THEME.fonts.ui,
        size: 9,
        color: { argb: hexToArgb(REPORT_THEME.colors.ink) },
      };

      cell.alignment = {
        horizontal: numeric ? 'right' : 'left',
        vertical: 'middle',
        wrapText: true,
      };

      cell.fill = fill(
        row.number % 2 === 0
          ? REPORT_THEME.colors.surface
          : REPORT_THEME.colors.panel,
      );

      cell.border = {
        bottom: {
          style: 'hair',
          color: { argb: hexToArgb(REPORT_THEME.colors.border) },
        },
      };

      cell.numFmt = excelNumberFormat(column);
    });
  });

  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: {
      row: Math.max(1, input.response.rows.length + 1),
      column: input.definition.columns.length,
    },
  };
}

function buildFiltersSheet(
  sheet: ExcelJS.Worksheet,
  input: ExportInput,
): void {
  sheet.columns = [{ width: 30 }, { width: 48 }];
  sheet.mergeCells('A1:B1');

  const title = sheet.getCell('A1');
  title.value = tr(input.t, 'reports.export.appliedFilters', 'Applied filters');
  title.font = {
    name: REPORT_THEME.fonts.ui,
    size: 14,
    bold: true,
    color: { argb: hexToArgb(REPORT_THEME.colors.panel) },
  };
  title.fill = fill(REPORT_THEME.colors.pharma);
  title.alignment = { vertical: 'middle' };

  sheet.getRow(1).height = 28;

  const rows: [string, string][] = [
    [
      tr(input.t, 'reports.export.from', 'From'),
      input.response.filters.dateFrom,
    ],
    [
      tr(input.t, 'reports.export.to', 'To'),
      input.response.filters.dateTo,
    ],
    [
      tr(
        input.t,
        'reports.export.comparePrevious',
        'Compare previous period',
      ),
      input.response.filters.comparePrevious
        ? tr(input.t, 'reports.export.yes', 'Yes')
        : tr(input.t, 'reports.export.no', 'No'),
    ],
    ['', ''],
    [
      tr(input.t, 'reports.export.dataFreshness', 'Data freshness'),
      '',
    ],
    [
      tr(input.t, 'reports.export.source', 'Source'),
      input.response.freshness.dataSource,
    ],
    [
      tr(input.t, 'reports.export.lastSync', 'Last synchronization'),
      input.response.freshness.lastSyncAt ?? '',
    ],
    [
      tr(input.t, 'reports.export.pendingOperations', 'Pending operations'),
      String(input.response.freshness.pendingOperations),
    ],
    [
      tr(input.t, 'reports.export.permanentFailures', 'Permanent failures'),
      String(input.response.freshness.permanentFailures),
    ],
  ];

  rows.forEach(([label, value], index) => {
    const row = sheet.getRow(index + 3);
    row.values = [label, value];

    if (!label) {
      row.height = 8;
      return;
    }

    const section = !value;

    row.height = 21;
    row.getCell(1).font = {
      name: REPORT_THEME.fonts.ui,
      size: section ? 10 : 9,
      bold: true,
      color: {
        argb: hexToArgb(
          section ? REPORT_THEME.colors.ink : REPORT_THEME.colors.inkMuted,
        ),
      },
    };

    row.getCell(2).font = {
      name: REPORT_THEME.fonts.ui,
      size: 9,
      color: { argb: hexToArgb(REPORT_THEME.colors.ink) },
    };

    row.eachCell((cell) => {
      cell.fill = fill(
        section ? REPORT_THEME.colors.surface : REPORT_THEME.colors.panel,
      );

      cell.border = {
        bottom: {
          style: 'hair',
          color: { argb: hexToArgb(REPORT_THEME.colors.border) },
        },
      };
    });
  });
}

function addMetaCard(
  sheet: ExcelJS.Worksheet,
  range: string,
  label: string,
  value: string,
): void {
  const [start, end] = range.split(':');
  const startColumn = start.replace(/\d+/gu, '');
  const endColumn = end.replace(/\d+/gu, '');
  const startRow = Number(start.replace(/\D+/gu, ''));
  const endRow = Number(end.replace(/\D+/gu, ''));

  sheet.mergeCells(`${startColumn}${startRow}:${endColumn}${startRow}`);
  sheet.mergeCells(
    `${startColumn}${startRow + 1}:${endColumn}${endRow}`,
  );

  const labelCell = sheet.getCell(`${startColumn}${startRow}`);
  labelCell.value = label.toUpperCase();
  labelCell.font = {
    name: REPORT_THEME.fonts.ui,
    size: 8,
    bold: true,
    color: { argb: hexToArgb(REPORT_THEME.colors.inkMuted) },
  };
  labelCell.fill = fill(REPORT_THEME.colors.surface);

  const valueCell = sheet.getCell(`${startColumn}${startRow + 1}`);
  valueCell.value = value;
  valueCell.font = {
    name: REPORT_THEME.fonts.ui,
    size: 10,
    color: { argb: hexToArgb(REPORT_THEME.colors.ink) },
  };
  valueCell.fill = fill(REPORT_THEME.colors.panel);
  valueCell.alignment = {
    vertical: 'middle',
    wrapText: true,
  };

  applyRangeBorder(sheet, range);
}

function applyRangeBorder(
  sheet: ExcelJS.Worksheet,
  range: string,
): void {
  const [start, end] = range.split(':');
  const startCell = sheet.getCell(start);
  const endCell = sheet.getCell(end);
  const { row: startRow, col: startCol } = startCell.fullAddress;
  const { row: endRow, col: endCol } = endCell.fullAddress;

  for (let row = startRow; row <= endRow; row++) {
    for (let column = startCol; column <= endCol; column++) {
      const cell = sheet.getCell(row, column);

      cell.border = {
        top: {
          style: 'thin',
          color: { argb: hexToArgb(REPORT_THEME.colors.border) },
        },
        bottom: {
          style: 'thin',
          color: { argb: hexToArgb(REPORT_THEME.colors.border) },
        },
        left: {
          style: 'thin',
          color: { argb: hexToArgb(REPORT_THEME.colors.border) },
        },
        right: {
          style: 'thin',
          color: { argb: hexToArgb(REPORT_THEME.colors.border) },
        },
      };
    }
  }
}

function fill(color: string): ExcelJS.Fill {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: hexToArgb(color) },
  };
}