import { z } from 'zod';

export const StartPhysicalCountSchema = z.object({
  notes: z.string().max(1000).optional(),
});

export type StartPhysicalCountDto = z.infer<typeof StartPhysicalCountSchema>;
