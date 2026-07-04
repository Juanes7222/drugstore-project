import { z } from 'zod';
import { CashCountType } from '@pharmacy/shared-types';

export const RegisterCashCountSchema = z.object({
  countType: z.enum([CashCountType.PARTIAL, CashCountType.CLOSING]),
  paymentMethodId: z.string().uuid(),
  expectedAmount: z.string().transform((val) => {
    const { Decimal } = require('@prisma/client').Prisma;
    return new Decimal(val);
  }),
  declaredAmount: z.string().transform((val) => {
    const { Decimal } = require('@prisma/client').Prisma;
    return new Decimal(val);
  }),
  denominationsBreakdown: z.record(z.string(), z.number()).optional(),
});

export type RegisterCashCountDto = z.infer<typeof RegisterCashCountSchema>;
