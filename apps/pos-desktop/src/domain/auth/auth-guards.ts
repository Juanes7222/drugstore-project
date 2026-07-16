/**
 * Auth guard utilities for the POS desktop app.
 *
 * Provides pure functions that check whether a given session combination
 * (online and/or offline) satisfies a required authentication level.
 *
 * Guards are framework-agnostic — they take session objects as plain
 * arguments and return a structured result, leaving rendering (disabled
 * buttons, toasts, redirects) to the UI layer.
 */
import { type LocalSession } from './local-session.store';
import { type OfflineSession, isSessionValid } from './offline';

// ---------------------------------------------------------------------------
// Guard results
// ---------------------------------------------------------------------------

export interface AuthGuardResult {
  /** Whether the operation is allowed. */
  allowed: boolean;

  /**
   * Human-readable explanation when `allowed` is `false`.
   * The caller should pass this through i18n rather than rendering it
   * verbatim.
   */
  reason?: string;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/**
 * Check whether there is **any** authenticated session available, whether
 * online or offline.
 *
 * @param onlineSession  The current online (server-authenticated) session,
 *                       or `null`.
 * @param offlineSession The current offline (locally-authenticated)
 *                       session, or `null`.
 * @returns `true` when at least one session is active.
 */
export function isAuthenticated(
  onlineSession: LocalSession | null,
  offlineSession: OfflineSession | null,
): boolean {
  return onlineSession !== null || offlineSession !== null;
}

/**
 * Check whether the current session combination is sufficient for an
 * operation that requires a specific trust level.
 *
 * @param requiredLevel   The trust level the operation needs.
 *   - `'LOCAL'` — sale confirmation, returns, inventory adjustments.
 *     Either an online or an offline session is sufficient.
 *   - `'SERVER_TRUSTED'` — remote step-up approval, user management,
 *     configuration changes. Requires a valid online session.
 * @param onlineSession   The current online session, or `null`.
 * @param offlineSession  The current offline session, or `null`.
 * @returns `{ allowed, reason }` describing whether the operation can
 *          proceed and, if not, why.
 */
export function canPerformOperation(
  requiredLevel: 'LOCAL' | 'SERVER_TRUSTED',
  onlineSession: LocalSession | null,
  offlineSession: OfflineSession | null,
): AuthGuardResult {
  if (requiredLevel === 'LOCAL') {
    // Local operations: any kind of session is sufficient.
    if (onlineSession) {
      return { allowed: true };
    }

    if (offlineSession) {
      // Even un-blessed sessions are allowed for local-only operations.
      // The session validity (expired/revoked) is a broader concern
      // enforced upstream by the offline auth service.
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: 'No active session — please log in to continue',
    };
  }

  // SERVER_TRUSTED operations require a valid online session.
  if (!onlineSession) {
    // Check if there is an offline session that could explain why the
    // user is here without an online one.
    if (offlineSession) {
      return {
        allowed: false,
        reason:
          'This operation requires server connectivity — ' +
          'please connect to the server and log in again',
      };
    }

    return {
      allowed: false,
      reason: 'No active session — please log in to continue',
    };
  }

  return { allowed: true };
}

/**
 * Verify that an offline session is still valid (not expired, not revoked).
 *
 * This is a convenience wrapper around the domain's `isSessionValid` that
 * returns the same `AuthGuardResult` shape as the other guards.
 *
 * @param offlineSession The current offline session.
 * @param revocationList The current revocation list (may be empty).
 * @returns `{ allowed, reason }`.
 */
export function isOfflineSessionUsable(
  offlineSession: OfflineSession,
  revocationList: import('./offline').RevocationListEntry[],
): AuthGuardResult {
  const { valid, reason } = isSessionValid(
    offlineSession,
    new Date(),
    revocationList,
  );

  if (!valid) {
    return { allowed: false, reason };
  }

  return { allowed: true };
}
