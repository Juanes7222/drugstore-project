/**
 * Public surface of the local reports module.
 *
 * Consumers should import from this barrel, not from the individual
 * files — the file layout can move without breaking the public API.
 */

export * from './report-types';
export * from './report-catalog';
export * from './report-permissions';
export * from './report-filter-schemas';
export * from './report-query-builders';
export * from './report-aggregations.service';
export * from './report-cache.service';
export * from './report-freshness.service';
export * from './report-execution.service';
export * from './report-export.service';
export {
  ReportScheduler,
  useReportSchedulesStore,
  type ReportSchedule,
  type ScheduleExecutionResult,
} from './report-scheduler.service';
export * from './shift-close-document.service';
export * from './exceptions';
