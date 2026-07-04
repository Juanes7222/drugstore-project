import { z } from 'zod';

/**
 * Temporary local schema for a single sync operation in a batch payload.
 * Candidate for promotion to @pharmacy/shared-validation once frontend form needs the same shape.
 * Matches SyncQueue model fields: operationType, payload, payloadHash, sourceWorkstationId, sourceCreatedAt, clientSequence.
 */
export const SyncOperationSchema = z.object({
  operationType: z.enum([
    'CREATE_SALE',
    'UPDATE_SALE',
    'CREATE_ADJUSTMENT',
    'UPDATE_ADJUSTMENT',
    'CREATE_PURCHASE_ORDER',
    'UPDATE_PURCHASE_ORDER',
    'SYNC_CATALOG',
  ]),
  payload: z.record(z.string(), z.any()),
  payloadHash: z.string().min(1, 'Payload hash is required'),
  sourceWorkstationId: z.uuid('Invalid workstation ID'),
  sourceCreatedAt: z.string().datetime('Invalid ISO 8601 datetime'),
  clientSequence: z
    .number()
    .int()
    .positive('Client sequence must be a positive integer'),
});

export type SyncOperationInput = z.infer<typeof SyncOperationSchema>;

export const SyncBatchSchema = z.object({
  operations: z
    .array(SyncOperationSchema)
    .min(1, 'At least one operation is required'),
});

export type SyncBatchInput = z.infer<typeof SyncBatchSchema>;
