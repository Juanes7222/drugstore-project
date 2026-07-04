import { z } from 'zod';

export const RejectInventoryAdjustmentSchema = z.object({
  rejectionReason: z.string().min(1, 'Rejection reason is required').max(1000),
});

export type RejectInventoryAdjustmentDto = z.infer<typeof RejectInventoryAdjustmentSchema>;
