import { z } from 'zod';

export const AnnulInventoryAdjustmentSchema = z.object({
  annulmentReason: z.string().min(1, 'Annulment reason is required').max(1000),
});

export type AnnulInventoryAdjustmentDto = z.infer<typeof AnnulInventoryAdjustmentSchema>;
