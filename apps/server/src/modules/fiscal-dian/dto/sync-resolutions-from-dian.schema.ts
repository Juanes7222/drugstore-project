import { z } from 'zod';

/**
 * Body for POST /fiscal-dian/resolutions/sync-from-dian.
 *
 * Everything else the flow needs (issuer NIT, environment, certificate) is
 * resolved server-side from the tenant's fiscal configuration; the caller
 * only optionally names a workstation to auto-allocate the full range to.
 */
export const SyncResolutionsFromDianSchema = z.object({
  workstationId: z
    .string()
    .uuid('Invalid workstation UUID')
    .nullable()
    .optional(),
});

export type SyncResolutionsFromDianInput = z.infer<
  typeof SyncResolutionsFromDianSchema
>;
