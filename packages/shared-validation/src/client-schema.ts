import { z } from "zod";

const IdentificationTypeEnum = z.enum([
  "CC",
  "NIT",
  "CE",
  "PASSPORT",
  "TI",
  "PEP",
]);

export const ClientSchema = z.object({
  firstName: z
    .string()
    .min(1, "El nombre es obligatorio")
    .max(100),
  lastName: z
    .string()
    .min(1, "El apellido es obligatorio")
    .max(100),
  identificationType: IdentificationTypeEnum,
  identificationNumber: z
    .string()
    .min(1, "El numero de identificacion es obligatorio")
    .max(20),
  email: z
    .email("Correo electronico invalido")
    .nullable()
    .optional(),
  phone: z
    .string()
    .max(20)
    .nullable()
    .optional(),
  address: z
    .string()
    .max(255)
    .nullable()
    .optional(),
});
