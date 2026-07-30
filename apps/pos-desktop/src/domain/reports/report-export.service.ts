import { saveFileWithDialog } from '../../common/native-save';
import type { ReportExportFormat } from './report-types';
import { renderCsv } from './report-export-csv.renderer';
import { renderExcel } from './report-export-excel.renderer';
import {
  FILE_FILTERS,
  MIME_TYPES,
  browserDownload,
  extensionFor,
  stampForFilename,
} from './report-export-file';
import { tr } from './report-export-i18n';
import { renderPdf } from './report-export-pdf.renderer';
import { renderPrintHtml } from './report-export-print.renderer';
import type {
  ExportFileContent,
  ExportInput,
} from './report-export.types';

export type { ExportInput } from './report-export.types';

export class ReportExportService {
  async exportAndDownload(input: ExportInput): Promise<string | null> {
    if (input.format === 'print') {
      this.openPrintWindow(input);
      return null;
    }

    const filename = `${input.filenamePrefix}-${stampForFilename()}.${extensionFor(input.format)}`;
    const content = await this.render(input.format, input);

    if (input.showDialog === false) {
      browserDownload(content, filename, MIME_TYPES[input.format]);
      return null;
    }

    return saveFileWithDialog({
      content,
      filename,
      mimeType: MIME_TYPES[input.format],
      filters: [FILE_FILTERS[input.format]],
      title: tr(input.t, 'reports.exports.saveTitle', 'Save report'),
    });
  }

  private async render(
    format: Exclude<ReportExportFormat, 'print'>,
    input: ExportInput,
  ): Promise<ExportFileContent> {
    switch (format) {
      case 'csv':
        return renderCsv(input);

      case 'excel':
        return renderExcel(input);

      case 'pdf':
        return renderPdf(input);
    }
  }

  private openPrintWindow(input: ExportInput): void {
    const printWindow = window.open('', '_blank', 'noopener');

    if (!printWindow) {
      return;
    }

    printWindow.document.open();
    printWindow.document.write(renderPrintHtml(input));
    printWindow.document.close();

    printWindow.requestAnimationFrame(() => {
      printWindow.print();
    });
  }
}