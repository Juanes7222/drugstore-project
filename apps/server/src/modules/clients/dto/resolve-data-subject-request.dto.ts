import { z } from 'zod';

export const ResolveDataSubjectRequestSchema = z.object({
  resolution: z.enum(['APPROVE', 'REJECT']),
  resolutionNotes: z.string().optional(),
});

export type ResolveDataSubjectRequestDto = z.infer<typeof ResolveDataSubjectRequestSchema>;
