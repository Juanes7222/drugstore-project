import { z } from 'zod';

/**
 * Query parameters for the local-number-hint endpoint.
 * This is a local schema; promote to @pharmacy/shared-validation if other
 * consumers need it.
 */
export const LocalNumberHintQuerySchema = z.object({
  workstationId: z.string().min(1, 'workstationId is required'),
});

export type LocalNumberHintQueryInput = z.infer<typeof LocalNumberHintQuerySchema>;
