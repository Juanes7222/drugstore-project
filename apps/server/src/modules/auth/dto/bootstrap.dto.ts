import { z } from 'zod';

// Local schema (no shared equivalent yet) — promotion candidate for
// @pharmacy/shared-validation.
export const BootstrapSchema = z.object({
  email: z.string().email(),
  displayName: z.string().min(1).max(100).optional(),
});

export class BootstrapDto implements z.infer<typeof BootstrapSchema> {
  email!: string;
  displayName?: string;
}