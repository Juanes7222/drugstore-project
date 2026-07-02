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
});
