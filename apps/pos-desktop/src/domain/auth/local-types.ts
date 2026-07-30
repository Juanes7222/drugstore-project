/**
 * Types for the local User replica cache.
 *
 * The POS stores a local copy of each User entity in PGlite with its
 * password verifier, so authentication works fully offline.  This is NOT
 * a separate identity — same UUID as the server, same credential, same role.
 *
 * ## Session trust
 *
 * After local password verification the session is created immediately.
 * The `sessionTrust` field tracks whether the server has confirmed the
 * user's current status (active, not revoked, password not changed).
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Status enums
// ---------------------------------------------------------------------------

/** Replication status between local PGlite replica and server. */
export type UserSyncStatus = 'PENDING' | 'SYNCED' | 'REJECTED';

/** How this user authenticates locally. */
export type CredentialMode = 'PASSWORD';

/** Active / disabled. */
export type UserStatus = 'ACTIVE' | 'DISABLED';

/**
 * How much the server has confirmed this session.
 *
 * - `LOCAL_UNVERIFIED` — authenticated against local replica only.
 * - `SERVER_VERIFIED` — server validated the session online.
 * - `OFFLINE_BLESSED` — server blessed an offline-started session.
 */
export type SessionTrust = 'LOCAL_UNVERIFIED' | 'SERVER_VERIFIED' | 'OFFLINE_BLESSED';

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/**
 * Local replica of the User entity stored in PGlite.
 */
export interface UserData {
  id: string;
  username: string;
  displayName: string;
  role: string;
  status: UserStatus;
  passwordVersion: number;
  credentialMode: CredentialMode;
  createdLocally: boolean;
  syncStatus: UserSyncStatus;
  syncError: string | null;
  failedLoginAttempts: number;
  lockedUntil: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  deletedAt: string | null;
}

/** Result of a local password verification attempt. */
export interface PasswordVerificationResult {
  valid: boolean;
  locked: boolean;
  remainingAttempts: number;
}
