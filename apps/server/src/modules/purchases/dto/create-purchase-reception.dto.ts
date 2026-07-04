import { z } from "zod";

export const CreatePurchaseReceptionItemSchema = z.object({
  productId: z.string().uuid("Invalid product ID"),
  purchaseOrderItemId: z.string().uuid("Invalid purchase order item ID").optional(),
  receivedQuantity: z.number().int().positive("Received quantity must be positive"),
  lotNumber: z.string().min(1, "Lot number is required").optional(),
  expirationDate: z.string().datetime("Invalid expiration date format").optional(),
  realUnitCost: z.number().positive("Real unit cost must be positive"),
  taxSchemeId: z.string().uuid("Invalid tax scheme ID"),
  taxRate: z.number().min(0).max(100).step(0.01, "Tax rate must be a valid percentage"),
  discountAmount: z.number().min(0).optional().default(0),
});

export const CreatePurchaseReceptionSchema = z.object({
  supplierId: z.string().uuid("Invalid supplier ID"),
  purchaseOrderId: z.string().uuid("Invalid purchase order ID").optional(),
  notes: z.string().optional(),
  items: z.array(CreatePurchaseReceptionItemSchema).min(1, "Purchase reception must have at least one item"),
});

export type CreatePurchaseReceptionDto = z.infer<typeof CreatePurchaseReceptionSchema>;
export type CreatePurchaseReceptionItemDto = z.infer<typeof CreatePurchaseReceptionItemSchema>;
