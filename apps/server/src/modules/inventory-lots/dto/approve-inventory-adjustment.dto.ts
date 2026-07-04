import { z } from 'zod';

export const ApproveInventoryAdjustmentSchema = z.object({
  approvalNotes: z.string().max(1000).optional(),
});

export type ApproveInventoryAdjustmentDto = z.infer<typeof ApproveInventoryAdjustmentSchema>;
