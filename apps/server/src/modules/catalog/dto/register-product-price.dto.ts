import { z } from 'zod';

export const RegisterProductPriceSchema = z.object({
  price: z.string().min(1, 'Price is required'),
  effectiveFrom: z.string().datetime().optional(),
  changeReason: z.string().optional(),
});

export type RegisterProductPriceDto = z.infer<typeof RegisterProductPriceSchema>;
