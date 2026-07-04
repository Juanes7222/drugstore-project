import { ClientSchema } from '@pharmacy/shared-validation';
import { z } from 'zod';

export const CreateClientSchema = ClientSchema.extend({
  municipality: z.string().max(100).optional().nullable(),
  department: z.string().max(100).optional().nullable(),
}).omit({
  firstName: true,
  lastName: true,
}).extend({
  fullName: z.string().min(1).max(200),
});

export type CreateClientDto = z.infer<typeof CreateClientSchema>;
