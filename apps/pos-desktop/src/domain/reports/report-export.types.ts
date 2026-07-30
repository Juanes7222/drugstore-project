import type {
  ReportDefinition,
  ReportExportFormat,
  ReportResponse,
} from './report-types';

export interface ExportInput {
  response: ReportResponse;
  definition: ReportDefinition;
  format: ReportExportFormat;
  chartDataUrl?: string;
  filenamePrefix: string;
  userDisplayName: string;
  t?: (key: string, options?: { defaultValue?: string }) => string;
  locale?: string;
  showDialog?: boolean;
}

export type ExportFileContent = string | ArrayBuffer;

export interface ExportFileFilter {
  name: string;
  extensions: string[];
}

export type ExportFileFilters = Record<
  Exclude<ReportExportFormat, 'print'>,
  ExportFileFilter
>;