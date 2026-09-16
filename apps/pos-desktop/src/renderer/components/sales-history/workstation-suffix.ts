// Short workstation suffix for ticket numbers, which restart per source workstation.

/**
 * Derives the 4-character workstation code shown next to a ticket number.
 *
 * Ticket numbers (`localNumber`) restart per source workstation, so two
 * distinct sales can render as the same `#N` in the global history. The
 * disambiguator is the source workstation id with fallback to the owning
 * workstation id, matching the `POS XXXX` convention used elsewhere.
 *
 * @param sourceWorkstationId Workstation whose sequence issued the number, if known.
 * @param workstationId Owning workstation fallback, if known.
 * @returns Uppercase last-4 code, or null when both ids are missing (legacy history).
 */
export function getWorkstationSuffixCode(
  sourceWorkstationId?: string | null,
  workstationId?: string | null,
): string | null {
  const raw = (sourceWorkstationId ?? workstationId ?? '').trim();
  if (!raw) return null;
  return raw.slice(-4).toUpperCase();
}
