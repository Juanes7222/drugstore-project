import { z } from 'zod';

export const ForceCloseCashShiftSchema = z.object({
  closingNotes: z.string().min(1, 'Closing notes are required for force close'),
});

export type ForceCloseCashShiftDto = z.infer<typeof ForceCloseCashShiftSchema>;
