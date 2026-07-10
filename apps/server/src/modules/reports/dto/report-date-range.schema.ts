import { z } from 'zod';

/**
 * Temporary local schema for report date range query parameters.
 * Candidate for promotion to @pharmacy/shared-validation once frontend form needs the same shape.
 * Shared by all report endpoints.
 */
export const ReportDateRangeSchema = z.object({
  dateFrom: z.string().datetime('Invalid ISO 8601 datetime'),
  dateTo: z.string().datetime('Invalid ISO 8601 datetime'),
  /**
   * Report view mode.
   *
   * - `'fiscal'` (default) — strict fiscal view using immutable invoice data.
   * - `'operational'` — accepted for API forward compatibility with POS terminals that
   *   resolve local invoice adjustments. On the server both views produce identical data
   *   because the `InvoiceLocalAdjustment` table is local-only to each terminal.
   */
  view: z.enum(['fiscal', 'operational']).optional().default('fiscal'),
});

export type ReportDateRangeInput = z.infer<typeof ReportDateRangeSchema>;
