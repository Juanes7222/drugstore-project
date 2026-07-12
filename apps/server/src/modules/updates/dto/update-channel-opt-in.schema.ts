import { z } from 'zod';

/**
 * Schema for opting a location into the beta channel.
 */
export const UpdateChannelOptInSchema = z.object({
  locationId: z.string().min(1),
  channel: z.enum(['STABLE', 'BETA']),
});

export type UpdateChannelOptInInput = z.infer<typeof UpdateChannelOptInSchema>;
