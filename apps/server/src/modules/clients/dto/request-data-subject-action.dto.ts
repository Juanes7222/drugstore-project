import { z } from 'zod';

export const RequestDataSubjectActionSchema = z.object({
  requestType: z.enum(['RECTIFICATION', 'ERASURE']),
});

export type RequestDataSubjectActionDto = z.infer<typeof RequestDataSubjectActionSchema>;
