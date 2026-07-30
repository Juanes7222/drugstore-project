import { getTenantInfo } from '../configuration/local-config.store';
import type { ExportInput } from './report-export.types';
import {
  formatKpiValue,
  formatPdfCell,
  pdfColumnWidth,
} from './report-export-formatters';
import { tr } from './report-export-i18n';
import { REPORT_THEME, hexToRgb } from './report-export-theme';

export async function renderPdf(
  input: ExportInput,
): Promise<ArrayBuffer> {
  ensureSharedArrayBuffer();

  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const locale = input.locale ?? 'es-CO';
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

  drawHeader(doc, input, pageWidth, margin, colors);

  let cursorY = 88;

  doc.setTextColor(...colors.ink);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'bold');
  doc.setFontSize(15);
  doc.text(input.definition.code, margin, cursorY);

  cursorY += 17;

  cursorY = drawMetadata(
    doc,
    input,
    cursorY,
    margin,
    usableWidth,
    locale,
    colors,
  );

  cursorY += 14;

  doc.setTextColor(...colors.ink);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'bold');
  doc.setFontSize(10);
  doc.text(
    tr(input.t, 'reports.export.indicators', 'Indicators'),
    margin,
    cursorY,
  );

  cursorY += 10;

  cursorY = drawKpis(
    doc,
    input,
    cursorY,
    margin,
    usableWidth,
    locale,
    colors,
  );

  if (input.chartDataUrl) {
    cursorY = drawChart(
      doc,
      input.chartDataUrl,
      cursorY,
      margin,
      usableWidth,
      pageHeight,
      colors,
    );
  }

  const headers = input.definition.columns.map((column) =>
    tr(input.t, column.titleKey, column.titleKey),
  );

  const rows = input.response.rows.map((row) =>
    input.definition.columns.map((column) =>
      formatPdfCell(row, column, locale),
    ),
  );

  if (rows.length === 0) {
    doc.setTextColor(...colors.muted);
    doc.setFont(REPORT_THEME.fonts.pdfFallback, 'normal');
    doc.setFontSize(9);
    doc.text(
      tr(
        input.t,
        'reports.export.noData',
        'No data for the selected filters.',
      ),
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
        input.definition.columns.map((column, index) => [
          index,
          {
            halign: column.align === 'right' ? 'right' : 'left',
            cellWidth: pdfColumnWidth(column.type),
          },
        ]),
      ),
      didDrawPage: () => {
        drawHeader(doc, input, pageWidth, margin, colors);
      },
    });
  }

  const totalPages = doc.getNumberOfPages();

  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    drawFooter(doc, input, pageWidth, pageHeight, margin, colors);
  }

  return doc.output('arraybuffer');
}

function ensureSharedArrayBuffer(): void {
  if (typeof globalThis.SharedArrayBuffer === 'undefined') {
    globalThis.SharedArrayBuffer = ArrayBuffer as unknown as typeof SharedArrayBuffer;
  }
}

function drawHeader(
  doc: import('jspdf').jsPDF,
  input: ExportInput,
  pageWidth: number,
  margin: number,
  colors: PdfPalette,
): void {
  const tenant = getTenantInfo();

  doc.setFillColor(...colors.pharma);
  doc.rect(0, 0, pageWidth, 56, 'F');

  doc.setFillColor(
    ...(input.response.freshness.pendingOperations > 0
      ? colors.sync
      : colors.pharma),
  );
  doc.rect(0, 56, pageWidth, 2, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'bold');
  doc.setFontSize(13);
  doc.text(tenant.name, margin, 24);

  const identity = [
    tenant.nit ? `NIT ${tenant.nit}` : '',
    tenant.address ?? '',
  ]
    .filter(Boolean)
    .join(' · ');

  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'normal');
  doc.setFontSize(8);
  doc.text(identity, margin, 39);
}

function drawFooter(
  doc: import('jspdf').jsPDF,
  input: ExportInput,
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
    tr(
      input.t,
      'reports.export.localSource',
      'Local workstation database',
    ),
    margin,
    pageHeight - 14,
  );

  doc.text(
    `${tr(input.t, 'reports.export.page', 'Page')} ${page} ${tr(input.t, 'reports.export.of', 'of')} ${total}`,
    pageWidth - margin,
    pageHeight - 14,
    { align: 'right' },
  );
}

function drawMetadata(
  doc: import('jspdf').jsPDF,
  input: ExportInput,
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

  doc.text(tr(input.t, 'reports.export.period', 'PERIOD'), left, y + 15);
  doc.text(
    tr(input.t, 'reports.export.generatedAt', 'GENERATED'),
    right,
    y + 15,
  );

  doc.setTextColor(...colors.ink);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'bold');
  doc.setFontSize(9);

  doc.text(
    `${input.response.filters.dateFrom} — ${input.response.filters.dateTo}`,
    left,
    y + 30,
  );

  doc.text(
    new Date(input.response.generatedAt).toLocaleString(locale),
    right,
    y + 30,
  );

  doc.setTextColor(...colors.muted);
  doc.setFont(REPORT_THEME.fonts.pdfFallback, 'normal');
  doc.setFontSize(7);

  doc.text(
    `${tr(input.t, 'reports.export.user', 'USER').toUpperCase()}: ${input.userDisplayName}`,
    left,
    y + 43,
  );

  doc.text(
    `${tr(input.t, 'reports.export.source', 'SOURCE').toUpperCase()}: ${input.response.freshness.dataSource}`,
    right,
    y + 43,
  );

  return y + 52;
}

function drawKpis(
  doc: import('jspdf').jsPDF,
  input: ExportInput,
  y: number,
  margin: number,
  usableWidth: number,
  locale: string,
  colors: PdfPalette,
): number {
  const cardGap = 10;
  const cardHeight = 48;
  const cardWidth = (usableWidth - cardGap) / 2;

  input.response.kpis.forEach((kpi, index) => {
    const x = margin + (index % 2) * (cardWidth + cardGap);
    const cardY = y + Math.floor(index / 2) * (cardHeight + 8);

    doc.setFillColor(...colors.panel);
    doc.setDrawColor(...colors.border);
    doc.roundedRect(x, cardY, cardWidth, cardHeight, 4, 4, 'FD');

    doc.setTextColor(...colors.muted);
    doc.setFont(REPORT_THEME.fonts.pdfFallback, 'bold');
    doc.setFontSize(7);
    doc.text(
      tr(input.t, kpi.titleKey, kpi.titleKey).toUpperCase(),
      x + 10,
      cardY + 15,
    );

    doc.setTextColor(...colors.pharma);
    doc.setFontSize(13);
    doc.text(
      formatKpiValue(kpi.value, locale),
      x + 10,
      cardY + 34,
    );
  });

  return y + Math.ceil(input.response.kpis.length / 2) * (cardHeight + 8);
}

function drawChart(
  doc: import('jspdf').jsPDF,
  chartDataUrl: string,
  y: number,
  margin: number,
  usableWidth: number,
  pageHeight: number,
  colors: PdfPalette,
): number {
  const chartHeight = Math.min(165, pageHeight - y - 90);

  if (chartHeight <= 80) {
    return y;
  }

  const chartY = y + 12;

  doc.setFillColor(...colors.panel);
  doc.setDrawColor(...colors.border);
  doc.roundedRect(margin, chartY, usableWidth, chartHeight, 4, 4, 'FD');

  try {
    doc.addImage(
      chartDataUrl,
      'PNG',
      margin + 8,
      chartY + 8,
      usableWidth - 16,
      chartHeight - 16,
    );
  } catch {
    return chartY + chartHeight + 16;
  }

  return chartY + chartHeight + 16;
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