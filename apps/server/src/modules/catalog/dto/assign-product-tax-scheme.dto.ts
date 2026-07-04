import { z } from 'zod';

export const AssignProductTaxSchemeSchema = z.object({
  taxSchemeId: z.uuid('Tax scheme ID must be a valid UUID'),
  effectiveFrom: z.string().datetime().optional(),
  changeReason: z.string().optional(),
});

export type AssignProductTaxSchemeDto = z.infer<typeof AssignProductTaxSchemeSchema>;
