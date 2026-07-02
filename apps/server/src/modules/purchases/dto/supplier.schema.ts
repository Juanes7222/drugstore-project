import { z } from 'zod';

/**
 * Temporary local schema for supplier creation and updates.
 * Candidate for promotion to @pharmacy/shared-validation once frontend form needs the same shape.
 */
export const SupplierSchema = z.object({
  name: z
    .string()
    .min(1, 'Supplier name is required')
    .max(255, 'Supplier name must not exceed 255 characters'),
  identificationType: z.enum(['NIT', 'CC', 'CE', 'PASSPORT']),
  identificationNumber: z
    .string()
    .min(1, 'Identification number is required')
    .max(50),
  email: z.string().email('Invalid email format').optional(),
  phoneNumber: z.string().max(20).optional(),
  country: z.string().default('CO'),
  creditLimit: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Invalid currency format')
    .optional(),
});

export type SupplierInput = z.infer<typeof SupplierSchema>;
