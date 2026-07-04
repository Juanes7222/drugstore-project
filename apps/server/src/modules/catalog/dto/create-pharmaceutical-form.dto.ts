import { z } from 'zod';

export const CreatePharmaceuticalFormSchema = z.object({
  name: z.string().min(1, 'Pharmaceutical form name is required'),
  sortOrder: z.number().int().nonnegative().default(0),
});

export type CreatePharmaceuticalFormDto = z.infer<typeof CreatePharmaceuticalFormSchema>;
