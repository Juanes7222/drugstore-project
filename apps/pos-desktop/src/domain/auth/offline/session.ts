/**
 * Offline session lifecycle functions.
 *
 * All functions are **pure** — they take state in and return new state out
 * without side effects, I/O, or mutations of their arguments.
 */
import {
  decodeOfflineToken,
  isRevoked,
  isTokenExpired,
} from './validation';
import type {
  OfflineSession,
  OfflineTokenClaims,
  BlessingResult,
  RevocationListEntry,
} from './types';

// ---------------------------------------------------------------------------
// Session creation
// ---------------------------------------------------------------------------

/**
 * Create a new `OfflineSession` from server-verified claims.
 *
 * The new session starts with `isBlessed === false`.  The caller is
 * responsible for requesting a server blessing before allowing
 * privileged operations.
 *
 * @param userId                 Server-side user ID.
 * @param username               User's login name.
 * @param displayName            Human-readable display name.
 * @param role                   User's server-assigned role.
 * @param subscriptionId         Tenant identifier or `null`.
 * @param claims                 Decoded offline token claims (must already
 *                               be verified by the caller).
 * @param workstationFingerprint Current device fingerprint.
 * @returns A new, un-blessed offline session.
 */
export function createOfflineSession(
  userId: string,
  username: string,
  displayName: string,
  role: string,
  subscriptionId: string | null,
  _claims: OfflineTokenClaims,
  workstationFingerprint: string,
): OfflineSession {
  const now = new Date();

  return {
    localSessionId: generateLocalSessionId(),
    userId,
    username,
    displayName,
    role,
    subscriptionId,
    offlineToken: '', // Populated by the caller after creation
    workstationFingerprint,
    createdAt: now,
    lastActiveAt: now,
    isBlessed: false,
  };
}

/**
 * Generate a unique local session identifier.
 *
 * Uses `crypto.randomUUID()` when available (modern browsers, Node 19+),
 * falls back to a timestamp-based ID for environments without it.
 */
function generateLocalSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch {
    // Fall through to fallback.
  }

  // Fallback: timestamp + random hex
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `offline-${timestamp}-${random}`;
}

// ---------------------------------------------------------------------------
// Blessing flow
// ---------------------------------------------------------------------------

/**
 * Mark a session as pending server blessing.
 *
 * Returns a new session object with `isBlessed` set to `false` and
 * `lastActiveAt` updated.  The original session is not mutated.
 *
 * @param session  The current session state.
 * @returns A new session with updated blessing status.
 */
export function markPendingBlessing(session: OfflineSession): OfflineSession {
  return {
    ...session,
    isBlessed: false,
    lastActiveAt: new Date(),
    // Clear any previous blessing or rejection timestamps
    blessedAt: undefined,
    rejectedAt: undefined,
    rejectionReason: undefined,
  };
}

/**
 * Apply a server blessing result to a session.
 *
 * If the session is blessed, the `replacementToken` from the result is
 * applied (the caller must persist the new token to SecureStorage).
 * If rejected, the rejection reason and timestamp are recorded.
 *
 * @param session  The session to update.
 * @param result   The blessing result from the server.
 * @returns A new session reflecting the blessing outcome.
 */
export function applyBlessingResult(
  session: OfflineSession,
  result: BlessingResult,
): OfflineSession {
  const now = new Date();

  if (result.status === 'BLESSED') {
    return {
      ...session,
      isBlessed: true,
      blessedAt: now,
      rejectedAt: undefined,
      rejectionReason: undefined,
      lastActiveAt: now,
      offlineToken:
        result.replacementToken?.offlineToken ?? session.offlineToken,
    };
  }

  // REJECTED
  return {
    ...session,
    isBlessed: false,
    blessedAt: undefined,
    rejectedAt: now,
    rejectionReason: (result.reason ??
      'UNKNOWN') as OfflineSession['rejectionReason'],
    lastActiveAt: now,
  };
}

// ---------------------------------------------------------------------------
// Session validity
// ---------------------------------------------------------------------------

/**
 * Check whether a session is still valid.
 *
 * A session is valid when:
 *  1. Its offline token has not expired.
 *  2. Its token's `jti` has not been revoked.
 *
 * @param session         The session to check.
 * @param now             Reference time.
 * @param revocationList  Current revocation list.
 * @returns An object with `valid: boolean` and an optional `reason` string.
 */
export function isSessionValid(
  session: OfflineSession,
  now: Date,
  revocationList: RevocationListEntry[],
): { valid: boolean; reason?: string } {
  // A session without an offline token cannot be validated.
  if (!session.offlineToken) {
    return { valid: false, reason: 'no offline token present' };
  }

  // Decode the token to read its claims (signature verification is the
  // caller's responsibility — this function performs structural checks).
  const claims = decodeOfflineToken(session.offlineToken);
  if (!claims) {
    return { valid: false, reason: 'offline token is malformed' };
  }

  // Token expiry check
  if (isTokenExpired(claims, now)) {
    return { valid: false, reason: 'offline token has expired' };
  }

  // Revocation list check using the token's jti
  if (isRevoked(claims.jti, revocationList)) {
    return { valid: false, reason: 'offline token has been revoked' };
  }

  // Previous rejection by the server
  if (session.rejectedAt) {
    return {
      valid: false,
      reason: session.rejectionReason ?? 'session was rejected by the server',
    };
  }

  return { valid: true };
}

/**
 * Filter a list of sessions, returning only those that are still valid.
 *
 * @param sessions        Sessions to filter.
 * @param now             Reference time.
 * @param revocationList  Current revocation list.
 * @returns An array of sessions that pass `isSessionValid`.
 */
export function filterValidSessions(
  sessions: OfflineSession[],
  now: Date,
  revocationList: RevocationListEntry[],
): OfflineSession[] {
  return sessions.filter(
    (session) => isSessionValid(session, now, revocationList).valid,
  );
}
