import { z } from 'zod';

/**
 * Temporary local schema for inventory adjustment document creation.
 * Candidate for promotion to @pharmacy/shared-validation once frontend form needs the same shape.
 */
export const CreateInventoryAdjustmentSchema = z.object({
  reason: z
    .string()
    .min(1, 'Reason is required')
    .max(500, 'Reason must not exceed 500 characters'),
  notes: z.string().max(1000).optional(),
  items: z
    .array(
      z.object({
        lotId: z.uuid('Invalid lot ID'),
        quantityAdjustment: z
          .string()
          .regex(/^-?\d+$/, 'Quantity adjustment must be an integer'),
        unitCost: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, 'Invalid currency format'),
      }),
    )
    .min(1, 'At least one item is required'),
});

export type CreateInventoryAdjustmentInput = z.infer<
  typeof CreateInventoryAdjustmentSchema
>;
