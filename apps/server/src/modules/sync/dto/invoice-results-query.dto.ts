import { z } from 'zod';

/**
 * Query parameters for the GET /sync/invoice-results endpoint.
 *
 * workstationId is required; since is optional (ISO-8601 datetime).
 * If since is omitted, results from the last 24 hours are returned.
 */
export const InvoiceResultsQuerySchema = z.object({
  workstationId: z.string().min(1, 'workstationId is required'),
  since: z
    .string()
    .datetime('since must be a valid ISO-8601 datetime')
    .optional(),
});

export type InvoiceResultsQueryInput = z.infer<typeof InvoiceResultsQuerySchema>;
