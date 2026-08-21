import { z } from "zod";
import type { ImportColumnMeta } from "./import-common";

/**
 * Accepted headers for product imports. Aliases are matched lowercased and
 * trimmed, so accent and case variants ("Nombre Comercial", "nombre_comercial")
 * resolve to the same column.
 */
export const PRODUCT_IMPORT_COLUMNS: ImportColumnMeta[] = [
  {
    key: "internalCode",
    label: "Codigo interno",
    aliases: ["codigo interno", "codigo", "internal code", "internal_code"],
    required: true,
    description: "Codigo unico del producto en la farmacia",
  },
  {
    key: "commercialName",
    label: "Nombre comercial",
    aliases: ["nombre comercial", "nombre", "commercial name", "commercial_name"],
    required: true,
    description: "Nombre comercial del producto",
  },
  {
    key: "laboratory",
    label: "Laboratorio",
    aliases: ["laboratorio", "lab", "laboratory"],
    required: true,
    description: "Laboratorio fabricante",
  },
  {
    key: "concentration",
    label: "Concentracion",
    aliases: ["concentracion", "concentration"],
    required: false,
    description: "Concentracion del principio activo (ej: 500)",
  },
  {
    key: "concentrationUnit",
    label: "Unidad de concentracion",
    aliases: ["unidad de concentracion", "unidad", "concentration unit", "concentration_unit"],
    required: false,
    description: "Unidad de la concentracion (ej: mg, ml)",
  },
  {
    key: "saleType",
    label: "Tipo de venta",
    aliases: ["tipo de venta", "tipo venta", "venta", "sale type", "sale_type"],
    required: false,
    description: "LIBRE | PRESCRIPCION | CONTROLADO (acepta: venta libre, prescripcion, controlado)",
  },
  {
    key: "minimumStock",
    label: "Stock minimo",
    aliases: ["stock minimo", "stock minimo", "minimo", "minimum stock", "minimum_stock"],
    required: false,
    description: "Cantidad minima de existencia",
  },
  {
    key: "invimaRegistry",
    label: "Registro INVIMA",
    aliases: ["registro invima", "invima", "invima registry", "invima_registry"],
    required: false,
    description: "Numero de registro sanitario INVIMA",
  },
  {
    key: "atcCode",
    label: "Codigo ATC",
    aliases: ["codigo atc", "atc", "atc code", "atc_code"],
    required: false,
    description: "Clasificacion ATC del medicamento",
  },
  {
    key: "categoryName",
    label: "Categoria",
    aliases: ["categoria", "category", "category_name"],
    required: false,
    description: "Nombre de la categoria existente en el sistema",
  },
  {
    key: "pharmaceuticalFormName",
    label: "Forma farmaceutica",
    aliases: ["forma farmaceutica", "forma", "pharmaceutical form", "pharmaceutical_form"],
    required: false,
    description: "Nombre de la forma farmaceutica existente en el sistema",
  },
  {
    key: "initialPrice",
    label: "Precio de venta",
    aliases: ["precio de venta", "precio venta", "precio", "selling price", "price", "initial_price"],
    required: true,
    description: "Precio de venta en pesos, punto como separador decimal (ej: 12500.50)",
  },
  {
    key: "initialCost",
    label: "Precio de compra",
    aliases: ["precio de compra", "precio compra", "costo", "cost", "initial_cost"],
    required: false,
    description: "Costo de adquisicion en pesos (opcional)",
  },
  {
    key: "taxSchemeName",
    label: "Impuesto",
    aliases: ["impuesto", "iva", "tax scheme", "tax_scheme", "tax"],
    required: true,
    description: "Nombre del esquema de impuesto existente en el sistema (ej: IVA 19%)",
  },
];

const SaleTypeEnum = z.enum(["FREE_SALE", "PRESCRIPTION", "CONTROLLED_SUBSTANCE"]);

/** Spanish/abbreviated variants accepted in the saleType column. */
export const PRODUCT_SALE_TYPE_ALIASES: Record<string, string> = {
  libre: "FREE_SALE",
  "venta libre": "FREE_SALE",
  "libre venta": "FREE_SALE",
  prescripcion: "PRESCRIPTION",
  "bajo prescripcion": "PRESCRIPTION",
  "venta bajo prescripcion": "PRESCRIPTION",
  formula: "PRESCRIPTION",
  controlado: "CONTROLLED_SUBSTANCE",
  "sustancia controlada": "CONTROLLED_SUBSTANCE",
};

const saleTypeWithAliases = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  return PRODUCT_SALE_TYPE_ALIASES[normalized] ?? normalized;
}, SaleTypeEnum);

const priceString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "Precio invalido, use punto como separador decimal");

/**
 * Validates one raw product row. Raw cells arrive as strings from CSV/Excel;
 * JSON imports may carry native numbers, so numeric fields are coerced.
 */
export const ProductImportRowSchema = z.object({
  internalCode: z.string().min(1, "El codigo interno es obligatorio"),
  commercialName: z.string().min(1, "El nombre comercial es obligatorio"),
  laboratory: z.string().min(1, "El laboratorio es obligatorio"),
  concentration: z.string().optional(),
  concentrationUnit: z.string().optional(),
  saleType: saleTypeWithAliases.default("FREE_SALE"),
  minimumStock: z.coerce.number().int().min(0, "El stock minimo no puede ser negativo").default(0),
  invimaRegistry: z.string().optional(),
  atcCode: z.string().optional(),
  categoryName: z.string().optional(),
  pharmaceuticalFormName: z.string().optional(),
  initialPrice: priceString,
  initialCost: priceString.optional(),
  taxSchemeName: z.string().min(1, "El impuesto es obligatorio"),
});

export type ProductImportRow = z.infer<typeof ProductImportRowSchema>;