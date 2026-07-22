import { z } from 'zod';

// Matches the same 4-6 digit numeric pattern as ChangePinSchema.
// Promotion candidate: shared-validation PIN regex constant.
export const ResetPinSchema = z.object({
  newPin: z
    .string()
    .min(4)
    .max(6)
    .regex(/^\d+$/, 'PIN must be numeric')
    .optional(),
});

export class ResetPinDto implements z.infer<typeof ResetPinSchema> {
  newPin?: string;
}
