import { z } from 'zod';

/**
 * Query parameters for the public GET /updates/check endpoint.
 */
export const UpdateCheckQuerySchema = z.object({
  currentVersion: z.string().min(1, 'currentVersion is required'),
  workstationId: z.string().min(1, 'workstationId is required'),
  channel: z.enum(['STABLE', 'BETA']).default('STABLE'),
  licensePlanCode: z.string().optional(),
});

export type UpdateCheckQuery = z.infer<typeof UpdateCheckQuerySchema>;
