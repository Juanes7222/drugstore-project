import { z } from 'zod';
import { Prisma } from '@prisma/client';

export const OpenCashShiftSchema = z.object({
  openingBalance: z.string().transform((val) => new Prisma.Decimal(val)),
  openingNotes: z.string().optional(),
});

export type OpenCashShiftDto = z.infer<typeof OpenCashShiftSchema>;
