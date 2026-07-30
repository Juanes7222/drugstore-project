import type {
  ExportFileContent,
  ExportFileFilters,
} from './report-export.types';

export const FILE_FILTERS: ExportFileFilters = {
  csv: {
    name: 'CSV',
    extensions: ['csv'],
  },
  excel: {
    name: 'Excel',
    extensions: ['xlsx'],
  },
  pdf: {
    name: 'PDF',
    extensions: ['pdf'],
  },
};

export const MIME_TYPES = {
  csv: 'text/csv;charset=utf-8',
  excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
} as const;

export function extensionFor(format: 'csv' | 'excel' | 'pdf'): string {
  switch (format) {
    case 'excel':
      return 'xlsx';
    case 'pdf':
      return 'pdf';
    default:
      return 'csv';
  }
}

export function stampForFilename(): string {
  return new Date()
    .toISOString()
    .replace(/[.:]/gu, '-')
    .slice(0, 19);
}

export function browserDownload(
  content: ExportFileContent,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}