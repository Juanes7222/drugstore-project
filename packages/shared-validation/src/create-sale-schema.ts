import { z } from "zod";

const SaleTypeEnum = z.enum([
  "FREE_SALE",
  "PRESCRIPTION",
  "CONTROLLED_SUBSTANCE",
]);

const SaleItemInputSchema = z.object({
  productId: z
    .string()
    .uuid("ID de producto invalido"),
  quantity: z
    .number()
    .int()
    .positive("La cantidad debe ser mayor a cero"),
  unitPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Precio unitario invalido"),
  discount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Descuento invalido")
    .optional(),
});

export const CreateSaleSchema = z.object({
  saleType: SaleTypeEnum,
  clientId: z
    .string()
    .uuid("ID de cliente invalido")
    .nullable()
    .optional(),
  cashShiftId: z
    .string()
    .uuid("ID de turno de caja invalido"),
  items: z
    .array(SaleItemInputSchema)
    .min(1, "La venta debe tener al menos un producto"),
  prescriptionNumber: z
    .string()
    .nullable()
    .optional(),
  /**
   * Pre-computed totals snapshotted by the caller (offline-first POS replay
   * path). When provided, the server uses these values as the authoritative
   * sale-header amounts instead of recomputing from items. This prevents
   * `Total payments do not match total sale amount` failures when the
   * server's catalog has drifted from the POS snapshot between sale time
   * and sync time.
   *
   * Optional: legacy callers and direct HTTP API requests that do not carry
   * these still work — the server falls back to recomputing from items.
   */
  subtotal: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Subtotal invalido")
    .optional(),
  totalDiscount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Total descuento invalido")
    .optional(),
  totalTax: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Total impuesto invalido")
    .optional(),
  totalAmount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Total invalido")
    .optional(),
});
