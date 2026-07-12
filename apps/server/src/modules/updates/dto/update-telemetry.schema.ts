import { z } from 'zod';

/**
 * Schema for the POST /updates/telemetry body.
 */
export const UpdateTelemetrySchema = z.object({
  workstationId: z.string().min(1),
  licenseId: z.string().min(1),
  fromVersion: z.string().min(1),
  toVersion: z.string().nullable(),
  attemptId: z.string().min(1),
  outcome: z.enum([
    'CHECK_OK', 'CHECK_NO_UPDATE', 'CHECK_FAILED',
    'DOWNLOAD_STARTED', 'DOWNLOAD_COMPLETED', 'DOWNLOAD_FAILED',
    'INSTALL_STARTED', 'INSTALL_COMPLETED', 'INSTALL_FAILED',
    'MIGRATION_STARTED', 'MIGRATION_COMPLETED', 'MIGRATION_FAILED',
    'RESTARTED_OK', 'ROLLED_BACK', 'TELEMETRY_SENT',
  ]),
  errorMessage: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
  occurredAt: z.string().datetime(),
  signature: z.string().min(1),
});

export type UpdateTelemetryInput = z.infer<typeof UpdateTelemetrySchema>;
