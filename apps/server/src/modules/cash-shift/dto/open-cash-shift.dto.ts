import { z } from 'zod';
import { Prisma } from '@pharmacy/database';

/**
 * Global shift model: the shift created from this payload is store-wide.
 * The `x-workstation-id` request header no longer scopes the shift — it is
 * recorded only as the ORIGIN workstation that opened it, and any selling
 * user on any workstation sells into the resulting single OPEN shift.
 */
export const OpenCashShiftSchema = z.object({
  openingBalance: z.string().transform((val) => new Prisma.Decimal(val)),
  openingNotes: z.string().optional(),
});

export type OpenCashShiftDto = z.infer<typeof OpenCashShiftSchema>;
