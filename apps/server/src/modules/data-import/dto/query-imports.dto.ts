import { z } from 'zod';

export const QueryImportsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  entityKey: z.string().optional(),
});

export type QueryImportsDto = z.infer<typeof QueryImportsSchema>;
