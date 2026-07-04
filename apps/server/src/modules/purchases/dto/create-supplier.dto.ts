import { z } from "zod";
import { SupplierIdentificationType } from "@prisma/client";

export const CreateSupplierSchema = z.object({
  identificationType: z.nativeEnum(SupplierIdentificationType),
  identificationNumber: z.string().min(1, "Identification number is required"),
  businessName: z.string().min(1, "Business name is required"),
  contactName: z.string().optional(),
  phone: z.string().optional(),
  email: z.email("Invalid email format").optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  country: z.string().optional().default("CO"),
  paymentTermsDays: z.number().int().min(0).optional().default(0),
  creditLimit: z.number().positive().optional().default(0),
  isActive: z.boolean().optional().default(true),
});

export type CreateSupplierDto = z.infer<typeof CreateSupplierSchema>;
