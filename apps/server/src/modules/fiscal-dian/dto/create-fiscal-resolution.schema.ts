import { z } from 'zod';

/**
 * Temporary local schema for fiscal resolution creation.
 * Candidate for promotion to @pharmacy/shared-validation once frontend form needs the same shape.
 */
export const CreateFiscalResolutionSchema = z.object({
  workstationId: z.uuid('Invalid workstation ID'),
  documentType: z.enum(['INVOICE', 'POS_TICKET', 'CREDIT_NOTE', 'DEBIT_NOTE']),
  prefix: z
    .string()
    .min(1, 'Prefix is required')
    .max(10, 'Prefix must not exceed 10 characters'),
  rangeStart: z
    .string()
    .regex(/^\d+$/, 'Range start must be a positive integer'),
  rangeEnd: z
    .string()
    .regex(/^\d+$/, 'Range end must be a positive integer'),
  validFrom: z.string().datetime('Invalid ISO 8601 datetime'),
  validUntil: z.string().datetime('Invalid ISO 8601 datetime'),
});

export type CreateFiscalResolutionInput = z.infer<
  typeof CreateFiscalResolutionSchema
>;
