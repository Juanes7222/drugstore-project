import { z } from 'zod';

export const OpenCashShiftSchema = z.object({
  openingBalance: z.string().transform((val) => {
    const decimal = require('@prisma/client').Prisma.Decimal;
    return new decimal(val);
  }),
  openingNotes: z.string().optional(),
});

export type OpenCashShiftDto = z.infer<typeof OpenCashShiftSchema>;
