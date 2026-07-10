import { z } from 'zod';

export const CheckInSchema = z.object({
  activationToken: z.string().min(10),
  hardwareFingerprint: z.string().min(10).max(256),
});

export type CheckInDto = z.infer<typeof CheckInSchema>;
