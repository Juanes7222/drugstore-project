/**
 * Print fallback DTO — received from POS workstation when local printing
 * fails and server-side fallback is configured.
 */
import { z } from 'zod';

export const PrintFallbackSchema = z.object({
  /** Type of print job (SALE_RECEIPT, ELECTRONIC_INVOICE, etc.). */
  jobType: z.string().min(1),
  /** Path to the generated print payload on the workstation filesystem. */
  payloadPath: z.string().min(1),
  /** Payload format (PDF, ESC_POS, etc.). Defaults to PDF. */
  payloadType: z.string().optional().default('PDF'),
  /** Optional sale ID for traceability. */
  saleId: z.string().uuid().optional().nullable(),
});

export type PrintFallbackDto = z.infer<typeof PrintFallbackSchema>;
