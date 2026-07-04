import { z } from 'zod';

/**
 * Temporary local schema for cash-shift creation.
 * Candidate for promotion to @pharmacy/shared-validation once frontend form needs the same shape.
 */
export const CreateCashShiftSchema = z.object({
  workstationId: z.uuid('Invalid workstation ID'),
  openedByUserId: z.uuid('Invalid user ID'),
  baseCashAmount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Invalid currency format')
    .transform((val) => val),
  notes: z.string().max(500).optional(),
});

export type CreateCashShiftInput = z.infer<typeof CreateCashShiftSchema>;
