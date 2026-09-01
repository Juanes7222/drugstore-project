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
  // Relaxed from strict UUID to opaque identity string — accepts both
  // real production UUIDs and legacy seed ids ("user_admin", "user_cashier1",
  // etc. from seed constants ids.ts). Server User.id is String @id (no
  // @db.Uuid) so FK allows non-UUID; seed helpers create User with id =
  // 'user_admin'. Production should be UUID but validation must not reject
  // legitimate dev/seed data. Mirrors workstationId relaxation above.
  userId: z.string().trim().min(1, 'userId is required').max(128, 'userId too long'),
  openingBalance: z
    .union([z.string().min(1, 'openingBalance is required'), z.number()])
    .transform((v) => String(v)),
  openingNotes: z.string().optional().nullable(),
  // Relaxed from strict UUID to opaque identity string to match
  // pos-desktop workstation-identity (persistedWorkstationIdSchema: min(1).max(128)).
  // Supports VITE_WORKSTATION_ID env override ("ws_principal") and fingerprint
  // values. Server treats supplied workstationId as opaque; authoritative value
  // is entry.sourceWorkstationId in SyncOperationDispatcherService.handleShiftOpen.
  workstationId: z.string().trim().min(1).max(128).optional(),
  openedAt: z.string().datetime('Invalid openedAt datetime'),
});

export type ShiftOpenPayload = z.infer<typeof ShiftOpenPayloadSchema>;
