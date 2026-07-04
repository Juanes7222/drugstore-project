import { z } from 'zod';

export const SetClassificationSchema = z.object({
  classificationId: z.uuid(),
});

export type SetClassificationDto = z.infer<typeof SetClassificationSchema>;
