import { z } from "zod";

const SaleTypeEnum = z.enum([
  "FREE_SALE",
  "PRESCRIPTION",
  "CONTROLLED_SUBSTANCE",
]);

export const ProductSchema = z.object({
  name: z
    .string()
    .min(1, "El nombre del producto es obligatorio")
    .max(255),
  genericName: z
    .string()
    .min(1, "El nombre generico es obligatorio")
    .max(255),
  barcode: z
    .string()
    .min(1, "El codigo de barras es obligatorio"),
  invimaCertificate: z
    .string()
    .min(1, "El registro INVIMA es obligatorio"),
  saleType: SaleTypeEnum,
  requiresPrescription: z.boolean(),
  currentStock: z
    .number()
    .int()
    .nonnegative("El stock no puede ser negativo"),
  minimumStock: z
    .number()
    .int()
    .nonnegative("El stock minimo no puede ser negativo"),
  purchasePrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Precio de compra invalido"),
  sellingPrice: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Precio de venta invalido"),
  taxPercentage: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Porcentaje de impuesto invalido"),
  expirationDate: z
    .string()
    .datetime("Fecha de vencimiento invalida"),
});
