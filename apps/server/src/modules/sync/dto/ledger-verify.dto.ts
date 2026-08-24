import { z } from 'zod';

/**
 * Promotion candidate for @pharmacy/shared-validation once the POS client
 * consumes the same schema for its local ledger digest.
 */

/**
 * The POS reports every operation it holds in its local sync queue with
 * its local state. DISCARDED is reported (not hidden) precisely so the
 * server can flag locally-discarded movements as integrity violations.
 */
export const ClientOperationStatusSchema = z.enum([
  'SYNCED',
  'PENDING',
  'FAILED',
  'DISCARDED',
]);
export type ClientOperationStatus = z.infer<typeof ClientOperationStatusSchema>;

export const LedgerVerifyRequestSchema = z.object({
  workstationId: z.string().min(1),
  operations: z
    .array(
      z.object({
        operationUuid: z.string().min(1),
        status: ClientOperationStatusSchema,
        /** Local sequential number of the source movement, when applicable. */
        localNumber: z.number().int().positive().optional(),
      }),
    )
    .min(1)
    .max(1000),
});
export type LedgerVerifyRequestDto = z.infer<typeof LedgerVerifyRequestSchema>;

export const LedgerVerifyQuerySchema = z.object({
  workstationId: z.string().min(1).optional(),
});
export type LedgerVerifyQueryDto = z.infer<typeof LedgerVerifyQuerySchema>;

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export const LedgerVerdictSchema = z.enum([
  'OK',
  'NOT_SUBMITTED',
  'NOT_ACCEPTED',
  'STATUS_MISMATCH',
]);
export type LedgerVerdict = z.infer<typeof LedgerVerdictSchema>;
