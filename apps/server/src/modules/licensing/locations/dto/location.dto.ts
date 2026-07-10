import { z } from 'zod';

export const CreateLocationSchema = z.object({
  name: z.string().min(2).max(300),
  address: z.string().max(500).optional().nullable(),
  city: z.string().max(200).optional().nullable(),
  region: z.string().max(200).optional().nullable(),
  country: z.string().length(2).optional().default('CO'),
  taxId: z.string().max(50).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: z.email().optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const UpdateLocationSchema = z.object({
  name: z.string().min(2).max(300).optional(),
  address: z.string().max(500).nullable().optional(),
  city: z.string().max(200).nullable().optional(),
  region: z.string().max(200).nullable().optional(),
  country: z.string().length(2).optional(),
  taxId: z.string().max(50).nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  email: z.email().nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export type CreateLocationDto = z.infer<typeof CreateLocationSchema>;
export type UpdateLocationDto = z.infer<typeof UpdateLocationSchema>;
