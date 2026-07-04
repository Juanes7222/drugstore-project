import { z } from 'zod';

export const UpdateCategorySchema = z.object({
  name: z.string().min(1).optional(),
  sortOrder: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateCategoryDto = z.infer<typeof UpdateCategorySchema>;
