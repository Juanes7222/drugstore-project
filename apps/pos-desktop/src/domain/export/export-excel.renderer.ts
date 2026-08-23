/**
 * Excel renderer for generic export documents.
 *
 * Two sheets, so exports are BOTH human-friendly and machine-importable:
 * - Sheet 0 "Detalle": the data table with the header row in row 1 —
 *   exactly the shape the data-import pipeline expects (same contract as
 *   the downloadable import templates).  Only this sheet is read by the
 *   importer.
 * - Sheet 1 "Información": tenant band, document title, subtitle, and
 *   metadata rows (generated-at, user, applied filters).
 *
 * Same visual theme as the report exports.
 */

import ExcelJS from 'exceljs';
import {
  calculateColumnWidth,
  excelNumberFormat,
  hexToArgb,
  isNumericColumn,
  REPORT_THEME,
  resolveColumnHeader,
  toExcelValue,
  tr,
} from '../../common/export';
import { getTenantInfo } from '../configuration/local-config.store';
import type { ExportDocument } from './export.types';

export async function renderExcel(
  document: ExportDocument,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  const locale = document.locale ?? 'es-CO';

  workbook.creator = document.userDisplayName ?? 'Pharmacy POS';
  workbook.created = new Date(document.generatedAt ?? Date.now());
  workbook.modified = new Date();

  const detail = workbook.addWorksheet(
    tr(document.t, 'export.sheet.detail', 'Detalle'),
    {
      views: [{ state: 'frozen', ySplit: 1, showGridLines: false }],
      pageSetup: {
        orientation: 'landscape',
        paperSize: 9,
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    },
  );

  buildDataTable(detail, document);

  const info = workbook.addWorksheet(
    tr(document.t, 'export.sheet.info', 'Información'),
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

  buildInfoSheet(info, document, locale);

  return workbook.xlsx.writeBuffer();
}

function buildDataTable(
  sheet: ExcelJS.Worksheet,
  document: ExportDocument,
): void {
  const headers = document.columns.map((column) =>
    resolveColumnHeader(column, document.t),
  );

  sheet.columns = document.columns.map((column, index) => ({
    key: column.id,
    width: calculateColumnWidth(headers[index] ?? '', document.rows, column),
  }));

  // Header row MUST stay in row 1 — the data-import pipeline reads the
  // first worksheet's first row as the column headers.
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

  document.rows.forEach((sourceRow) => {
    const row = sheet.addRow(
      document.columns.map((column) =>
        toExcelValue(sourceRow[column.id], column),
      ),
    );

    row.height = 20;

    row.eachCell((cell, columnIndex) => {
      const column = document.columns[columnIndex - 1];
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
    to: { row: Math.max(1, 1 + document.rows.length), column: document.columns.length },
  };
}

function buildInfoSheet(
  sheet: ExcelJS.Worksheet,
  document: ExportDocument,
  locale: string,
): void {
  const tenant = getTenantInfo();
  const lastColumn = Math.max(2, document.columns.length);

  sheet.columns = [{ width: 30 }, { width: 48 }];

  // Tenant band.
  sheet.mergeCells(1, 1, 1, lastColumn);
  const title = sheet.getCell(1, 1);
  title.value = tenant.name;
  title.font = {
    name: REPORT_THEME.fonts.ui,
    size: 16,
    bold: true,
    color: { argb: hexToArgb(REPORT_THEME.colors.panel) },
  };
  title.fill = fill(REPORT_THEME.colors.pharma);
  title.alignment = { horizontal: 'left', vertical: 'middle' };
  sheet.getRow(1).height = 28;

  // Document title row.
  sheet.mergeCells(2, 1, 2, lastColumn);
  const docTitle = sheet.getCell(2, 1);
  docTitle.value = tr(document.t, document.titleKey, document.titleFallback);
  docTitle.font = {
    name: REPORT_THEME.fonts.ui,
    size: 11,
    bold: true,
    color: { argb: hexToArgb(REPORT_THEME.colors.ink) },
  };
  docTitle.alignment = { vertical: 'middle' };
  sheet.getRow(2).height = 20;

  // Optional subtitle (applied filters).
  if (document.subtitleKey && document.subtitleFallback) {
    sheet.mergeCells(3, 1, 3, lastColumn);
    const subtitle = sheet.getCell(3, 1);
    subtitle.value = tr(
      document.t,
      document.subtitleKey,
      document.subtitleFallback,
    );
    subtitle.font = {
      name: REPORT_THEME.fonts.ui,
      size: 9,
      color: { argb: hexToArgb(REPORT_THEME.colors.inkMuted) },
    };
    sheet.getRow(3).height = 16;
  }

  // Metadata rows (generated-at, user, screen-specific filters).
  const meta: Array<readonly [string, string, string]> = [
    [
      'export.meta.generatedAt',
      'Generado',
      new Date(document.generatedAt ?? Date.now()).toLocaleString(locale),
    ],
  ];
  if (document.userDisplayName) {
    meta.push(['export.meta.user', 'Usuario', document.userDisplayName]);
  }
  meta.push(...(document.metadata ?? []));

  let rowIndex = document.subtitleKey ? 5 : 4;
  for (const [labelKey, labelFallback, value] of meta) {
    const labelCell = sheet.getCell(rowIndex, 1);
    labelCell.value = tr(document.t, labelKey, labelFallback).toUpperCase();
    labelCell.font = {
      name: REPORT_THEME.fonts.ui,
      size: 8,
      bold: true,
      color: { argb: hexToArgb(REPORT_THEME.colors.inkMuted) },
    };
    labelCell.fill = fill(REPORT_THEME.colors.surface);

    const valueCell = sheet.getCell(rowIndex, 2);
    valueCell.value = value;
    valueCell.font = {
      name: REPORT_THEME.fonts.ui,
      size: 9,
      color: { argb: hexToArgb(REPORT_THEME.colors.ink) },
    };
    valueCell.fill = fill(REPORT_THEME.colors.panel);
    valueCell.alignment = { vertical: 'middle', wrapText: true };

    sheet.getRow(rowIndex).height = 18;
    rowIndex += 1;
  }
}

function fill(color: string): ExcelJS.Fill {
  return {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: hexToArgb(color) },
  };
}