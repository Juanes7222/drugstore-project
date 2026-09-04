import { z } from 'zod';

export const LoginIdentitiesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  // Accepted for forward compatibility with a future pre-login variant so POS
  // clients can send it unconditionally. Currently ignored: the Workstation
  // table carries no subscription/location linkage, so this value can never
  // scope the result and is not validated against the database.
  workstationId: z.string().min(1).max(100).optional(),
});

export type LoginIdentitiesQueryDto = z.infer<
  typeof LoginIdentitiesQuerySchema
>;
