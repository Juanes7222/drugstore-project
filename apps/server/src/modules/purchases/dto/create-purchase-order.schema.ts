import { z } from 'zod';

/**
 * Temporary local schema for purchase order creation.
 * Candidate for promotion to @pharmacy/shared-validation once frontend form needs the same shape.
 */
export const CreatePurchaseOrderSchema = z.object({
  supplierId: z.string().uuid('Invalid supplier ID'),
  notes: z.string().max(1000).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid('Invalid product ID'),
        quantity: z
          .string()
          .regex(/^\d+$/, 'Quantity must be a positive integer'),
        unitPrice: z
          .string()
          .regex(/^\d+(\.\d{1,2})?$/, 'Invalid currency format'),
      }),
    )
    .min(1, 'At least one item is required'),
});

export type CreatePurchaseOrderInput = z.infer<
  typeof CreatePurchaseOrderSchema
>;
