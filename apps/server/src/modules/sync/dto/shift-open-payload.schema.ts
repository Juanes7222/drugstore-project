import { z } from 'zod';

/**
 * Payload for SHIFT_OPEN sync operation.
 *
 * Sent by POS when opening a global cash shift offline. The server
 * replays it via SyncOperationDispatcherService.handleShiftOpen, preserving
 * the local workstation's UUID as the server CashShift.id for consistency
 * (same pattern as PRODUCT_CREATION with sourceProductId).
 *
 * Fields:
 * - shiftId: local workstation's UUID for the shift — becomes server id
 * - userId: user who opened the shift
 * - openingBalance: string decimal (e.g. "0", "100.00")
 * - openingNotes: optional free-text
 * - workstationId: source workstation id (authoritative value is entry.sourceWorkstationId)
 * - openedAt: ISO 8601 datetime when the shift was opened locally
 */
export const ShiftOpenPayloadSchema = z.object({
  shiftId: z.string().uuid('Invalid shiftId'),
  userId: z.string().uuid('Invalid userId'),
  openingBalance: z
    .union([z.string().min(1, 'openingBalance is required'), z.number()])
    .transform((v) => String(v)),
  openingNotes: z.string().optional().nullable(),
  workstationId: z.string().uuid().optional(),
  openedAt: z.string().datetime('Invalid openedAt datetime'),
});

export type ShiftOpenPayload = z.infer<typeof ShiftOpenPayloadSchema>;
