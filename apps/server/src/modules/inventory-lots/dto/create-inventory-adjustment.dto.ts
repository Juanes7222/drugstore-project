import { z } from 'zod';

export const CreateInventoryAdjustmentItemSchema = z.object({
  lotId: z.uuid('Invalid lot ID'),
  movementType: z.enum(['POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT']),
  quantity: z.number().int().positive('Quantity must be positive'),
  reason: z.string().max(500).optional(),
});

/**
 * @deprecated The `.min(1)` constraint on `items` has been removed from the
 * HTTP-level DTO because the POS validates adjustments locally. The
 * authoritative "at least one item is required" validation has been
 * relocated to `InventoryAdjustmentsService.create()` so that sync dispatcher
 * replays are also protected.
 */
export const CreateInventoryAdjustmentSchema = z.object({
  reason: z.string().max(500).optional(),
  notes: z.string().max(1000).optional(),
  items: z
    .array(CreateInventoryAdjustmentItemSchema),
});

export type CreateInventoryAdjustmentDto = z.infer<typeof CreateInventoryAdjustmentSchema>;
export type CreateInventoryAdjustmentItemDto = z.infer<typeof CreateInventoryAdjustmentItemSchema>;
