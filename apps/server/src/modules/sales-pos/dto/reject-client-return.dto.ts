import { z } from 'zod';

export const RejectClientReturnSchema = z.object({
  reason: z.string().min(1, 'Reason is required').max(1000),
});

export type RejectClientReturnDto = z.infer<typeof RejectClientReturnSchema>;
