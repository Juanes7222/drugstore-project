import { z } from 'zod';

/**
 * Schema for creating a FiscalResolution.
 * Matches the Prisma model's creation-relevant fields.
 * `state` defaults to ACTIVE and `currentConsecutive` defaults to 0 server-side.
 */
export const CreateFiscalResolutionSchema = z.object({
  resolutionNumber: z.string().min(1, 'Resolution number is required'),
  documentType: z.enum([
    'INVOICE',
    'POS_TICKET',
    'CREDIT_NOTE',
    'DEBIT_NOTE',
    'SUPPORT_DOCUMENT',
  ]),
  prefix: z
    .string()
    .min(1, 'Prefix is required')
    .max(10, 'Prefix must not exceed 10 characters'),
  rangeFrom: z.number().int().positive('Range start must be a positive integer'),
  rangeTo: z.number().int().positive('Range end must be a positive integer'),
  validFrom: z.string().datetime('Invalid ISO 8601 datetime'),
  validTo: z.string().datetime('Invalid ISO 8601 datetime'),
  workstationId: z.string().uuid('Invalid workstation UUID').nullable().optional(),
});

export type CreateFiscalResolutionInput = z.infer<typeof CreateFiscalResolutionSchema>;
