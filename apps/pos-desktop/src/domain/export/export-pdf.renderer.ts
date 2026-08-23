/**
 * PDF renderer for generic export documents.
 *
 * Header band with tenant identity, document title, a metadata box
 * (generated-at, user, screen-specific filters), then the data table via
 * jspdf-autotable.  Same visual language as the report PDF exports.
 */

import {
  formatPdfCell,
  hexToRgb,
  pdfColumnWidth,
  REPORT_THEME,
  resolveColumnHeader,
  tr,
} from '../../common/export';
import { getTenantInfo } from '../configuration/local-config.store';
import type { ExportDocument } from './export.types';

export async function renderPdf(
  document: ExportDocument,
): Promise<ArrayBuffer> {
  ensureSharedArrayBuffer();

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const locale = document.locale ?? 'es-CO';
  const doc = new jsPDF({
    unit: 'pt',
    format: 'a4',
    orientation: 'portrait',
    compress: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 32;
  const usableWidth = pageWidth - margin * 2;
  const colors = palette();

  drawHeader(doc, pageWidth, margin, colors);

  let cursorY = 88;

  doc.setTextColor(...colors.ink);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'bold');
  doc.setFontSize(15);
  doc.text(tr(document.t, document.titleKey, document.titleFallback), margin, cursorY);

  cursorY += 17;

  cursorY = drawMetadata(
    doc,
    document,
    cursorY,
    margin,
    usableWidth,
    locale,
    colors,
  );

  const headers = document.columns.map((column) =>
    resolveColumnHeader(column, document.t),
  );

  const rows = document.rows.map((row) =>
    document.columns.map((column) => formatPdfCell(row, column, locale)),
  );

  if (rows.length === 0) {
    doc.setTextColor(...colors.muted);
    doc.setFont(REPORT_THEME.fonts.pdfFallback, 'normal');
    doc.setFontSize(9);
    doc.text(
      tr(document.t, 'export.noData', 'No hay datos para exportar.'),
      margin,
      cursorY + 20,
    );
  } else {
    autoTable(doc, {
      startY: cursorY + 12,
      head: [headers],
      body: rows,
      theme: 'plain',
      showHead: 'everyPage',
      tableWidth: usableWidth,
      margin: {
        top: 68,
        right: margin,
        bottom: 40,
        left: margin,
      },
      styles: {
        font: REPORT_THEME.fonts.pdfFallback,
        fontSize: 7.4,
        cellPadding: 5,
        textColor: colors.ink,
        lineColor: colors.border,
        lineWidth: 0.35,
        overflow: 'linebreak',
        valign: 'middle',
      },
      headStyles: {
        fillColor: colors.pharma,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        halign: 'center',
        valign: 'middle',
      },
      alternateRowStyles: {
        fillColor: colors.surface,
      },
      columnStyles: Object.fromEntries(
        document.columns.map((column, index) => [
          index,
          {
            halign: column.align === 'right' ? 'right' : 'left',
            cellWidth: pdfColumnWidth(column.type),
          },
        ]),
      ),
      didDrawPage: () => {
        drawHeader(doc, pageWidth, margin, colors);
      },
    });
  }

  const totalPages = doc.getNumberOfPages();

  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    drawFooter(doc, document, pageWidth, pageHeight, margin, colors);
  }

  return doc.output('arraybuffer');
}

function ensureSharedArrayBuffer(): void {
  if (typeof globalThis.SharedArrayBuffer === 'undefined') {
    globalThis.SharedArrayBuffer =
      ArrayBuffer as unknown as typeof SharedArrayBuffer;
  }
}

function drawHeader(
  doc: import('jspdf').jsPDF,
  pageWidth: number,
  margin: number,
  colors: PdfPalette,
): void {
  const tenant = getTenantInfo();

  doc.setFillColor(...colors.pharma);
  doc.rect(0, 0, pageWidth, 56, 'F');

  doc.setFillColor(...colors.sync);
  doc.rect(0, 56, pageWidth, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'bold');
  doc.setFontSize(13);
  doc.text(tenant.name, margin, 24);

  const identity = [tenant.nit ? `NIT ${tenant.nit}` : '', tenant.address ?? '']
    .filter(Boolean)
    .join(' · ');

  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'normal');
  doc.setFontSize(8);
  doc.text(identity, margin, 39);
}

function drawFooter(
  doc: import('jspdf').jsPDF,
  document: ExportDocument,
  pageWidth: number,
  pageHeight: number,
  margin: number,
  colors: PdfPalette,
): void {
  const page = doc.getCurrentPageInfo().pageNumber;
  const total = doc.getNumberOfPages();

  doc.setDrawColor(...colors.border);
  doc.line(margin, pageHeight - 26, pageWidth - margin, pageHeight - 26);

  doc.setTextColor(...colors.muted);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'normal');
  doc.setFontSize(7.5);

  doc.text(
    tr(document.t, 'export.meta.source', 'Base de datos local'),
    margin,
    pageHeight - 14,
  );

  doc.text(
    `${tr(document.t, 'export.meta.page', 'Página')} ${page} ${tr(document.t, 'export.meta.of', 'de')} ${total}`,
    pageWidth - margin,
    pageHeight - 14,
    { align: 'right' },
  );
}

function drawMetadata(
  doc: import('jspdf').jsPDF,
  document: ExportDocument,
  y: number,
  margin: number,
  usableWidth: number,
  locale: string,
  colors: PdfPalette,
): number {
  const left = margin + 12;
  const right = margin + usableWidth / 2;

  doc.setFillColor(...colors.surface);
  doc.setDrawColor(...colors.border);
  doc.roundedRect(margin, y, usableWidth, 52, 4, 4, 'FD');

  doc.setTextColor(...colors.muted);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'normal');
  doc.setFontSize(7);

  doc.text(tr(document.t, 'export.meta.generatedAt', 'GENERADO'), left, y + 15);
  doc.text(
    tr(document.t, 'export.meta.user', 'USUARIO'),
    right,
    y + 15,
  );

  doc.setTextColor(...colors.ink);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'bold');
  doc.setFontSize(9);

  doc.text(
    new Date(document.generatedAt ?? Date.now()).toLocaleString(locale),
    left,
    y + 30,
  );

  doc.text(document.userDisplayName ?? '—', right, y + 30);

  doc.setTextColor(...colors.muted);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'normal');
  doc.setFontSize(7);

  const extra = document.metadata ?? [];
  const leftExtra = extra[0];
  const rightExtra = extra[1];

  if (leftExtra) {
    doc.text(
      `${tr(document.t, leftExtra[0], leftExtra[1]).toUpperCase()}: ${leftExtra[2]}`,
      left,
      y + 43,
    );
  }

  if (rightExtra) {
    doc.text(
      `${tr(document.t, rightExtra[0], rightExtra[1]).toUpperCase()}: ${rightExtra[2]}`,
      right,
      y + 43,
    );
  }

  return y + 52;
}

type PdfPalette = {
  pharma: [number, number, number];
  sync: [number, number, number];
  surface: [number, number, number];
  panel: [number, number, number];
  ink: [number, number, number];
  muted: [number, number, number];
  border: [number, number, number];
};

function palette(): PdfPalette {
  return {
    pharma: hexToRgb(REPORT_THEME.colors.pharma),
    sync: hexToRgb(REPORT_THEME.colors.sync),
    surface: hexToRgb(REPORT_THEME.colors.surface),
    panel: hexToRgb(REPORT_THEME.colors.panel),
    ink: hexToRgb(REPORT_THEME.colors.ink),
    muted: hexToRgb(REPORT_THEME.colors.inkMuted),
    border: hexToRgb(REPORT_THEME.colors.border),
  };
}