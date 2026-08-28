import { z } from 'zod';

/**
 * Single locally-recorded audit entry from `LocalAuditLog`.
 *
 * Mirrors `LocalAuditLog` columns written by `LocalAuditWriter` in
 * `apps/pos-desktop/src/domain/audit/local-audit-writer.service.ts`.
 * All optional fields are nullable on the local side; the server fills
 * `subscriptionId` from `TenantContext` and leaves `ipAddress`/`userAgent`
 * null for offline-originated rows (they are populated only for online
 * HTTP-intercepted rows).
 */
export const AuditLogBatchEntrySchema = z.object({
  id: z.string().uuid('Invalid audit log id'),
  action: z.string().min(1, 'action is required'),
  category: z.string().min(1, 'category is required'),
  entityType: z.string().nullable().optional(),
  entityId: z.string().nullable().optional(),
  entityName: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
  userId: z.string().nullable().optional(),
  userRole: z.string().nullable().optional(),
  workstationId: z.string().nullable().optional(),
  sessionId: z.string().nullable().optional(),
  correlationId: z.string().nullable().optional(),
  createdAt: z.string().datetime('Invalid ISO 8601 datetime'),
});

export type AuditLogBatchEntry = z.infer<typeof AuditLogBatchEntrySchema>;

export const AuditLogBatchPayloadSchema = z.object({
  logs: z.array(AuditLogBatchEntrySchema).min(1, 'At least one log is required').max(100, 'Batch too large'),
});

export type AuditLogBatchPayload = z.infer<typeof AuditLogBatchPayloadSchema>;
