// Data import module: modular CSV/Excel/JSON bulk intake for data-entry
// sections. Source adapters parse files; per-entity definitions map, validate
// and write rows; preview/execute endpoints expose the pipeline.

export { DataImportModule } from './data-import.module';
export { DataImportController } from './data-import.controller';
export { DataImportService } from './data-import.service';
export { DataImportProcessingJob } from './data-import-processing.job';
export { ImportParseCache } from './import-parse-cache';
export { ImportTemplateService } from './import-template.service';
export { ImportDefinitionRegistry } from './import-definition-registry';
export { ProductImportDefinition } from './product-import.definition';
export { ClientImportDefinition } from './client-import.definition';
export { CsvSourceAdapter } from './csv-source.adapter';
export { ExcelSourceAdapter } from './excel-source.adapter';
export { JsonSourceAdapter } from './json-source.adapter';
export {
  ImportDefinition,
  ImportExecutionContext,
  ImportRowWithNumber,
  ParseRowOutcome,
  buildAliasMap,
  missingRequiredHeaders,
  normalizeCellValue,
  normalizeHeader,
  zodIssuesToImportIssues,
} from './import-definition';
export type {
  ImportPreviewResult,
  ImportExecutionResult,
  ImportRowError,
} from './data-import.service';
export { IMPORTS_QUEUE, IMPORT_JOB_NAME } from './data-import-job';
export type { DataImportJobData, ImportJobProgress } from './data-import-job';
export type { DataImport, DataImportRow } from './entities/data-import.entity';
