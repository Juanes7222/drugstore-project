import { z } from 'zod';

/**
 * Upper bound for a batch flush ({ events: [...] }). The POS queue flushes
 * every few minutes, so this covers any realistic backlog while keeping
 * request payloads bounded.
 */
export const MAX_TELEMETRY_BATCH_SIZE = 50;

/**
 * Upper bound for errorMessage so an unbounded stack-trace blob cannot
 * blow up row size or log volume.
 */
export const MAX_TELEMETRY_ERROR_MESSAGE_LENGTH = 2000;

/**
 * Schema for one update-telemetry event (POST /updates/telemetry).
 *
 * Tolerances:
 * - toVersion is nullable AND optional: checks that find no update build the
 *   payload with toVersion undefined, and JSON.stringify drops undefined
 *   keys, so the field arrives absent rather than null.
 * - durationMs allows 0: a cache-hit check can complete within the same
 *   millisecond.
 * - The signature covers only the base fields (workstationId | licenseId |
 *   fromVersion | toVersion | attemptId | outcome | occurredAt), so
 *   errorMessage/durationMs are not signed by design.
 */
export const UpdateTelemetrySchema = z.object({
  workstationId: z.string().min(1),
  licenseId: z.string().min(1),
  fromVersion: z.string().min(1),
  toVersion: z.string().nullable().optional(),
  attemptId: z.string().min(1),
  outcome: z.enum([
    'CHECK_OK', 'CHECK_NO_UPDATE', 'CHECK_FAILED',
    'DOWNLOAD_STARTED', 'DOWNLOAD_COMPLETED', 'DOWNLOAD_FAILED',
    'INSTALL_STARTED', 'INSTALL_COMPLETED', 'INSTALL_FAILED',
    'MIGRATION_STARTED', 'MIGRATION_COMPLETED', 'MIGRATION_FAILED',
    'RESTARTED_OK', 'ROLLED_BACK', 'TELEMETRY_SENT',
  ]),
  errorMessage: z.string().max(MAX_TELEMETRY_ERROR_MESSAGE_LENGTH).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  occurredAt: z.string().datetime(),
  signature: z.string().min(1),
});

/** Batch envelope sent by the POS offline-queue flush. */
export const UpdateTelemetryBatchSchema = z.object({
  events: z
    .array(UpdateTelemetrySchema)
    .min(1)
    .max(MAX_TELEMETRY_BATCH_SIZE),
});

/**
 * Accepts either a single event or a batch envelope. The batch shape is
 * tried first because a bare event never carries an `events` key.
 */
export const UpdateTelemetryRequestSchema = z.union([
  UpdateTelemetryBatchSchema,
  UpdateTelemetrySchema,
]);

export type UpdateTelemetryInput = z.infer<typeof UpdateTelemetrySchema>;
export type UpdateTelemetryBatchInput = z.infer<
  typeof UpdateTelemetryBatchSchema
>;
export type UpdateTelemetryRequestInput = z.infer<
  typeof UpdateTelemetryRequestSchema
>;
