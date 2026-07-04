import { z } from 'zod';

export const SetClassificationSchema = z.object({
  classificationId: z.string().uuid(),
});

export type SetClassificationDto = z.infer<typeof SetClassificationSchema>;
