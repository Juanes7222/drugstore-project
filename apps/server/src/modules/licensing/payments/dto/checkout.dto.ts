import { z } from 'zod';
import { BillingPeriod } from '@pharmacy/shared-types';

export const CreateCheckoutSessionSchema = z.object({
  planCode: z.string().min(2).max(50),
  customerTaxId: z.string().min(3).max(50),
  customerEmail: z.string().email(),
  customerName: z.string().min(2).max(300),
  customerPhone: z.string().max(30).optional(),
  billingPeriod: z
    .nativeEnum(BillingPeriod)
    .optional()
    .default(BillingPeriod.MONTHLY),
});

export type CreateCheckoutSessionDto = z.infer<typeof CreateCheckoutSessionSchema>;
