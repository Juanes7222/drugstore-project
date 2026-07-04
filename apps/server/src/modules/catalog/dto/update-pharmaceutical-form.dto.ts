import { z } from 'zod';

export const UpdatePharmaceuticalFormSchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export type UpdatePharmaceuticalFormDto = z.infer<typeof UpdatePharmaceuticalFormSchema>;
