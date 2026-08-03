-- Sale: domicilio (delivery) data — SaleDeliveryInfo shape (state, address,
-- contactName, contactPhone, notes, scheduledAt, feeCents). NULL = the sale
-- is not a domicilio. Never part of the fiscal payload; the delivery fee is
-- a surcharge collected on top of the item total.
ALTER TABLE "Sale" ADD COLUMN IF NOT EXISTS "delivery" JSONB;
