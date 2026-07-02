import { z } from 'zod';

/**
 * Temporary local schema for report date range query parameters.
 * Candidate for promotion to @pharmacy/shared-validation once frontend form needs the same shape.
 * Shared by all four report endpoints.
 */
export const ReportDateRangeSchema = z.object({
  dateFrom: z.string().datetime('Invalid ISO 8601 datetime'),
  dateTo: z.string().datetime('Invalid ISO 8601 datetime'),
});

export type ReportDateRangeInput = z.infer<typeof ReportDateRangeSchema>;
