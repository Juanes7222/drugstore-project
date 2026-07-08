import { z } from 'zod';
import { Prisma } from '@pharmacy/database';
import { CashCountType } from '@pharmacy/shared-types';

export const RegisterCashCountSchema = z.object({
  countType: z.enum([CashCountType.PARTIAL, CashCountType.CLOSING]),
  paymentMethodId: z.uuid(),
  expectedAmount: z.string().transform((val) => new Prisma.Decimal(val)),
  declaredAmount: z.string().transform((val) => new Prisma.Decimal(val)),
  denominationsBreakdown: z.record(z.string(), z.number()).optional(),
});

export type RegisterCashCountDto = z.infer<typeof RegisterCashCountSchema>;
