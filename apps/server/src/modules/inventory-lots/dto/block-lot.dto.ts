import { z } from 'zod';

export const BlockLotSchema = z.object({
  reason: z.string().min(1, 'Block reason is required'),
});

export type BlockLotDto = z.infer<typeof BlockLotSchema>;
