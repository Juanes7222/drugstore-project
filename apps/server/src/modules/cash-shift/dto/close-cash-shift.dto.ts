import { z } from 'zod';

export const CloseCashShiftSchema = z.object({
  closingNotes: z.string().optional(),
});

export type CloseCashShiftDto = z.infer<typeof CloseCashShiftSchema>;
