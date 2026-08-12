import { ClientSchema } from '@pharmacy/shared-validation';
import { z } from 'zod';

export const CreateClientSchema = ClientSchema.extend({
  municipality: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
  /** Store credit limit in COP. Null = no credit; 0 = explicitly disabled. */
  creditLimit: z
    .number()
    .min(0)
    .max(999999999999.99)
    .optional()
    .nullable(),
}).omit({
  firstName: true,
  lastName: true,
}).extend({
  fullName: z.string().min(1).max(200),
});

export type CreateClientDto = z.infer<typeof CreateClientSchema>;
