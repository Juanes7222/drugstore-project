import { z } from 'zod';

export const RegisterPhysicalCountLineSchema = z.object({
  lotId: z.string().uuid('Invalid lot ID'),
  countedQuantity: z.number().int().min(0, 'Counted quantity must be non-negative'),
});

export type RegisterPhysicalCountLineDto = z.infer<typeof RegisterPhysicalCountLineSchema>;
