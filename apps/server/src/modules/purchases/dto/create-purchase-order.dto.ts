import { z } from "zod";

export const CreatePurchaseOrderItemSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  requestedQuantity: z.number().int().positive("Requested quantity must be positive"),
  expectedUnitCost: z.number().positive("Expected unit cost must be positive"),
});

export const CreatePurchaseOrderSchema = z.object({
  supplierId: z.string().uuid("Invalid supplier ID"),
  expectedDeliveryDate: z.string().datetime().optional(),
  notes: z.string().optional(),
  items: z.array(CreatePurchaseOrderItemSchema).min(1, "Purchase order must have at least one item"),
});

export type CreatePurchaseOrderDto = z.infer<typeof CreatePurchaseOrderSchema>;
export type CreatePurchaseOrderItemDto = z.infer<typeof CreatePurchaseOrderItemSchema>;
