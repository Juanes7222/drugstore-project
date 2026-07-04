import { z } from 'zod';

export const CreateCategorySchema = z.object({
  name: z.string().min(1, 'Category name is required'),
  sortOrder: z.number().int().nonnegative().default(0),
});

export type CreateCategoryDto = z.infer<typeof CreateCategorySchema>;
