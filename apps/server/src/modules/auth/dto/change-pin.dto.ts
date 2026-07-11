import { z } from 'zod';

export const ChangePinSchema = z.object({
  currentPin: z.string().min(4).max(6).regex(/^\d+$/),
  newPin: z.string().min(4).max(6).regex(/^\d+$/),
});

export class ChangePinDto implements z.infer<typeof ChangePinSchema> {
  currentPin!: string;
  newPin!: string;
}
