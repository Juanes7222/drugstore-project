import { z } from "zod";
import type { ImportColumnMeta } from "./import-common";

export const CLIENT_IMPORT_COLUMNS: ImportColumnMeta[] = [
  {
    key: "fullName",
    label: "Nombre completo",
    aliases: ["nombre completo", "nombre", "full name", "full_name", "nombres y apellidos"],
    required: true,
    description: "Nombre completo del cliente",
  },
  {
    key: "identificationType",
    label: "Tipo de documento",
    aliases: ["tipo de documento", "tipo documento", "tipo identificacion", "document type", "identification_type"],
    required: true,
    description: "CC | NIT | CE | PASSPORT | TI | PEP (acepta: cedula, nit, pasaporte, tarjeta de identidad)",
  },
  {
    key: "identificationNumber",
    label: "Numero de documento",
    aliases: ["numero de documento", "numero documento", "documento", "numero de identificacion", "identification_number"],
    required: true,
    description: "Numero de identificacion sin puntos ni guiones",
  },
  {
    key: "email",
    label: "Correo electronico",
    aliases: ["correo electronico", "correo", "email", "e-mail", "mail"],
    required: false,
    description: "Correo electronico del cliente",
  },
  {
    key: "phone",
    label: "Telefono",
    aliases: ["telefono", "celular", "phone", "telephone"],
    required: false,
    description: "Telefono o celular",
  },
  {
    key: "address",
    label: "Direccion",
    aliases: ["direccion", "address"],
    required: false,
    description: "Direccion de residencia",
  },
  {
    key: "municipality",
    label: "Municipio",
    aliases: ["municipio", "ciudad", "municipality"],
    required: false,
    description: "Municipio de residencia",
  },
  {
    key: "department",
    label: "Departamento",
    aliases: ["departamento", "department"],
    required: false,
    description: "Departamento de residencia",
  },
  {
    key: "creditLimit",
    label: "Limite de credito",
    aliases: ["limite de credito", "cupo", "credit limit", "credit_limit"],
    required: false,
    description: "Cupo de credito en pesos (opcional)",
  },
];

const IdentificationTypeEnum = z.enum(["CC", "NIT", "CE", "PASSPORT", "TI", "PEP"]);

/** Spanish/abbreviated variants accepted in the identificationType column. */
export const CLIENT_IDENTIFICATION_TYPE_ALIASES: Record<string, string> = {
  cc: "CC",
  cedula: "CC",
  "cedula de ciudadania": "CC",
  nit: "NIT",
  ce: "CE",
  "cedula de extranjeria": "CE",
  passport: "PASSPORT",
  pasaporte: "PASSPORT",
  ti: "TI",
  "tarjeta de identidad": "TI",
  pep: "PEP",
};

const identificationTypeWithAliases = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  return CLIENT_IDENTIFICATION_TYPE_ALIASES[normalized] ?? normalized;
}, IdentificationTypeEnum);

/**
 * Validates one raw client row. Raw cells arrive as strings from CSV/Excel;
 * JSON imports may carry native numbers, so numeric fields are coerced.
 */
export const ClientImportRowSchema = z.object({
  fullName: z.string().min(1, "El nombre completo es obligatorio"),
  identificationType: identificationTypeWithAliases,
  identificationNumber: z
    .string()
    .min(1, "El numero de documento es obligatorio")
    .max(20, "El numero de documento no puede superar 20 caracteres"),
  email: z.string().email("Correo electronico invalido").optional(),
  phone: z.string().max(20).optional(),
  address: z.string().max(255).optional(),
  municipality: z.string().max(100).optional(),
  department: z.string().max(100).optional(),
  creditLimit: z.coerce.number().min(0, "El limite de credito no puede ser negativo").optional(),
});

export type ClientImportRow = z.infer<typeof ClientImportRowSchema>;