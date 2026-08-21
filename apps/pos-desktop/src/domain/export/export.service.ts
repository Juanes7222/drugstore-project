/**
 * Data-export service — renders a generic export document to the requested
 * format and saves it through the native save dialog (or downloads it in
 * non-Tauri contexts).
 *
 * This is the listado-screens counterpart of the reports module's
 * `ReportExportService`: same transport, generic document shape.
 */

import {
  FILE_FILTERS,
  MIME_TYPES,
  browserDownload,
  extensionFor,
  stampForFilename,
  tr,
  type ExportFormat,
} from '../../common/export';
import { saveFileWithDialog } from '../../common/native-save';
import { renderCsv } from './export-csv.renderer';
import { renderExcel } from './export-excel.renderer';
import { renderPdf } from './export-pdf.renderer';
import { renderPrintHtml } from './export-print.renderer';
import { ExportException } from './exceptions';
import type { ExportDocument } from './export.types';

export interface ExportRequest {
  format: ExportFormat;
  document: ExportDocument;
  /** Filename prefix; a timestamp and the extension are appended. */
  filenamePrefix: string;
  /** When false, skips the save dialog and downloads directly. */
  showDialog?: boolean;
}

export class DataExportService {
  /**
   * Render and save an export document.
   *
   * @returns The saved file path, or `null` when the user cancelled the
   *          save dialog (or when printing via the print window).
   * @throws {ExportException} when rendering or writing the file fails.
   */
  async exportAndDownload(input: ExportRequest): Promise<string | null> {
    if (input.format === 'print') {
      this.openPrintWindow(input.document);
      return null;
    }

    const filename = `${input.filenamePrefix}-${stampForFilename()}.${extensionFor(input.format)}`;
    const content = await this.render(input.format, input.document);

    if (input.showDialog === false) {
      browserDownload(content, filename, MIME_TYPES[input.format]);
      return null;
    }

    return saveFileWithDialog({
      content,
      filename,
      mimeType: MIME_TYPES[input.format],
      filters: [FILE_FILTERS[input.format]],
      title: tr(
        input.document.t,
        'export.saveTitle',
        'Guardar exportación',
      ),
    });
  }

  private async render(
    format: Exclude<ExportFormat, 'print'>,
    document: ExportDocument,
  ): Promise<string | ArrayBuffer> {
    try {
      switch (format) {
        case 'csv':
          return renderCsv(document);

        case 'excel':
          // Await so async renderer failures surface as ExportException below.
          return await renderExcel(document);

        case 'pdf':
          return await renderPdf(document);
      }
    } catch (err) {
      throw new ExportException(
        `Failed to render export as ${format}`,
        'EXPORT_RENDER_FAILED',
        err,
      );
    }
  }

  private openPrintWindow(document: ExportDocument): void {
    const printWindow = window.open('', '_blank', 'noopener');

    if (!printWindow) {
      return;
    }

    printWindow.document.open();
    printWindow.document.write(renderPrintHtml(document));
    printWindow.document.close();

    printWindow.requestAnimationFrame(() => {
      printWindow.print();
    });
  }
}