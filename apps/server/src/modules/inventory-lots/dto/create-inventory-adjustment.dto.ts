import { z } from 'zod';

export const CreateInventoryAdjustmentItemSchema = z.object({
  lotId: z.string().uuid('Invalid lot ID'),
  movementType: z.enum(['POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT']),
  quantity: z.number().int().positive('Quantity must be positive'),
  reason: z.string().max(500).optional(),
});

export const CreateInventoryAdjustmentSchema = z.object({
  reason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  items: z
    .array(CreateInventoryAdjustmentItemSchema)
    .min(1, 'At least one item is required'),
});

export type CreateInventoryAdjustmentDto = z.infer<typeof CreateInventoryAdjustmentSchema>;
export type CreateInventoryAdjustmentItemDto = z.infer<typeof CreateInventoryAdjustmentItemSchema>;
