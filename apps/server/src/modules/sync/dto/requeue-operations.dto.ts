import { z } from 'zod';

export const RequeueOperationsSchema = z.object({
  operationUuids: z.array(z.string().min(1)).min(1).max(100),
});
export type RequeueOperationsDto = z.infer<typeof RequeueOperationsSchema>;
