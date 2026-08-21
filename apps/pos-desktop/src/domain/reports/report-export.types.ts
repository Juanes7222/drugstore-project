import type {
  ExportFileContent,
  ExportFileFilter,
  ExportFileFilters,
} from '../../common/export';
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

export type { ExportFileContent, ExportFileFilter, ExportFileFilters };