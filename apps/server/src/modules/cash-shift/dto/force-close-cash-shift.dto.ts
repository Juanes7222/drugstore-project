import { z } from 'zod';

/**
 * @deprecated The `.min(1)` constraint on `closingNotes` has been removed
 * from the HTTP-level DTO because the POS validates closures locally.
 * The authoritative "closing notes are required" validation has been
 * relocated to `CashShiftService.forceCloseShift()` so that sync dispatcher
 * replays are also protected.
 */
export const ForceCloseCashShiftSchema = z.object({
  closingNotes: z.string(),
});

export type ForceCloseCashShiftDto = z.infer<typeof ForceCloseCashShiftSchema>;
