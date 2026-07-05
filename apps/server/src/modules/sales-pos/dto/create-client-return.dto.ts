import { z } from 'zod';

export const CreateClientReturnItemLotSchema = z.object({
  lotId: z.string().uuid('Invalid lot ID'),
  quantity: z.number().int().positive('Quantity must be positive'),
});

export const CreateClientReturnItemSchema = z.object({
  saleItemId: z.string().uuid('Invalid sale item ID'),
  quantity: z.number().int().positive('Quantity must be positive'),
  lots: z.array(CreateClientReturnItemLotSchema).optional(),
});

export const CreateClientReturnSchema = z.object({
  saleId: z.string().uuid('Invalid sale ID'),
  refundMethodId: z.string().uuid('Invalid refund method ID').optional(),
  reason: z.string().optional(),
  items: z
    .array(CreateClientReturnItemSchema)
    .min(1, 'At least one item is required'),
});

export type CreateClientReturnDto = z.infer<typeof CreateClientReturnSchema>;
export type CreateClientReturnItemDto = z.infer<typeof CreateClientReturnItemSchema>;
export type CreateClientReturnItemLotDto = z.infer<typeof CreateClientReturnItemLotSchema>;
