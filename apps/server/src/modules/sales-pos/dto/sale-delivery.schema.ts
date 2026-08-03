import { z } from 'zod';

/**
 * DeliveryState values carried by the Sale.delivery JSON column.
 * Mirrors the DeliveryState union from @pharmacy/shared-types.
 */
export const DeliveryStateEnum = z.enum(['PENDING', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']);

/**
 * Zod schema for the domicilio (delivery) object attached to a sale.
 *
 * The shape matches SaleDeliveryInfo from @pharmacy/shared-types — the POS
 * sends this raw JSON inside `createSaleDto.delivery` on SALE_CONFIRMATION
 * sync operations and on direct HTTP sale creation. Allows null or absent
 * (a sale that is not a domicilio); feeCents must be a non-negative number.
 *
 * Promotion candidate to @pharmacy/shared-validation once the POS desktop
 * needs to validate the same shape server-authoritatively.
 */
export const SaleDeliveryInfoSchema = z.object({
  state: DeliveryStateEnum,
  address: z.string().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  notes: z.string().nullable(),
  /** ISO-8601 delivery date/time; null when scheduling is not used. */
  scheduledAt: z.string().nullable(),
  /** Delivery fee in COP cents; 0 when the tenant charges no fee. */
  feeCents: z.number().int().min(0),
});

export type SaleDeliveryInfoInput = z.infer<typeof SaleDeliveryInfoSchema>;