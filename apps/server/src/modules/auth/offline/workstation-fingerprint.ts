/**
 * Device binding written into an offline token's `wfp` claim and used as the
 * CVK transport-key input.
 *
 * A blank fingerprint is not a usable binding: `verifyToken` rejects any token
 * without `wfp`, the POS desktop refuses a token whose `wfp` differs from its
 * own fingerprint, and a CVK encrypted with an empty-fingerprint key cannot be
 * decrypted by anyone. Logins that send no fingerprint — the POS cashier switch
 * (QuickSwitch), the 2FA step, the web backoffice — therefore fall back to the
 * resolved workstation, which is the value the POS sends as its fingerprint
 * everywhere else.
 *
 * Pure and dependency-free on purpose: it is imported by both the offline token
 * service and the login flow, and unit specs that stub those services must keep
 * the real rule.
 */
export function resolveWorkstationFingerprint(
  workstationFingerprint: string | undefined | null,
  workstationId: string,
): string {
  return workstationFingerprint?.trim() || workstationId;
}
