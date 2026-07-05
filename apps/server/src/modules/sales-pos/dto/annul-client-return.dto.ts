import { z } from 'zod';

export const AnnulClientReturnSchema = z.object({
  annulmentReason: z.string().min(1, 'Annulment reason is required').max(1000),
});

export type AnnulClientReturnDto = z.infer<typeof AnnulClientReturnSchema>;
