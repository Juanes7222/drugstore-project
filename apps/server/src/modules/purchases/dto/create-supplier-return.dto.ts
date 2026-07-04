import { z } from 'zod';

export const CreateSupplierReturnItemSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  lotId: z.string().uuid('Invalid lot ID'),
  quantity: z.number().int().positive('Quantity must be positive'),
});

export const CreateSupplierReturnSchema = z.object({
  supplierId: z.string().uuid('Invalid supplier ID'),
  purchaseReceptionId: z.string().uuid('Invalid purchase reception ID').optional(),
  reason: z.string().optional(),
  items: z
    .array(CreateSupplierReturnItemSchema)
    .min(1, 'Supplier return must have at least one item'),
});

export type CreateSupplierReturnDto = z.infer<typeof CreateSupplierReturnSchema>;
export type CreateSupplierReturnItemDto = z.infer<typeof CreateSupplierReturnItemSchema>;
