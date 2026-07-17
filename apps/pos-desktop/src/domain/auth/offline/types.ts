/**
 * Offline auth domain types.
 *
 * These model the state required for the POS to authenticate users, cache
 * credentials, and manage sessions while disconnected from the server.
 * Every type is serialisable so it can be persisted to SecureStorage or
 * transferred across the Tauri IPC boundary.
 */

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/**
 * An offline session representing a user currently logged into this POS
 * workstation without server connectivity.
 *
 * Sessions start in a "pending blessing" state. The server must eventually
 * confirm ("bless") or reject them. Until blessed, certain privileged
 * operations may be restricted.
 */
export interface OfflineSession {
  /** Locally-generated UUID for this session instance. */
  localSessionId: string;

  /** Server-side user ID. */
  userId: string;

  /** User login identifier (username). */
  username: string;

  /** Human-readable name shown on the POS UI. */
  displayName: string;

  /** Server-assigned role (e.g. CASHIER, MANAGER, OWNER). */
  role: string;

  /** Subscription / tenant identifier, or `null` for single-tenant deployments. */
  subscriptionId: string | null;

  /**
   * The server-issued offline JWT that allows this workstation to
   * operate autonomously.  Stored in SecureStorage, not in this object,
   * once the session is created.
   */
  offlineToken: string;

  /** Unique hardware fingerprint of the workstation where the session was established. */
  workstationFingerprint: string;

  /** When this session was locally created. */
  createdAt: Date;

  /** Last activity timestamp used for idle detection. */
  lastActiveAt: Date;

  /** Whether the server has confirmed this offline session. */
  isBlessed: boolean;

  /** When the server blessed this session.  `undefined` if not yet blessed. */
  blessedAt?: Date;

  /** When the server rejected this session.  `undefined` if not rejected. */
  rejectedAt?: Date;

  /** Human-readable explanation provided by the server on rejection. */
  rejectionReason?: OfflineBlessingRejectionReason;
}

// ---------------------------------------------------------------------------
// Blessing
// ---------------------------------------------------------------------------

/**
 * Categorical reason the server rejected an offline blessing request.
 * Each value maps to a server-side validation check.
 */
export type OfflineBlessingRejectionReason =
  | 'USER_DISABLED'
  | 'USER_LOCKED'
  | 'USER_NOT_FOUND'
  | 'WORKSTATION_REVOKED'
  | 'WORKSTATION_NOT_FOUND'
  | 'LOCATION_ACCESS_REVOKED'
  | 'TOKEN_EXPIRED'
  | 'TOKEN_SIGNATURE_INVALID'
  | 'TOKEN_REVOKED'
  | 'FRAUD_DETECTED'
  | 'WORKSTATION_FINGERPRINT_MISMATCH';

/** Result of a server-side offline blessing check. */
export interface BlessingResult {
  /** The local session ID this result applies to. */
  localSessionId: string;

  /** Whether the server accepted or rejected the offline session. */
  status: 'BLESSED' | 'REJECTED';

  /** Human-readable explanation (present on rejection, optional on acceptance). */
  reason?: string;

  /**
   * Fresh token set provided by the server on success.
   * The caller MUST persist these to SecureStorage.
   */
  replacementToken?: {
    accessToken: string;
    refreshToken: string;
    offlineToken: string;
    expiresAt: Date;
  };
}

// ---------------------------------------------------------------------------
// Offline JWT claims
// ---------------------------------------------------------------------------

/**
 * Claims carried by the offline JWT token issued by the server.
 *
 * Naming is intentionally concise to keep the token's wire size small:
 *   sub – userId
 *   sid – sessionId
 *   wfp – workstation fingerprint
 *   typ – always `"offline"`
 */
export interface OfflineTokenClaims {
  /** Server-side user ID (`sub` in JWT standard claims). */
  sub: string;
  /** Server-side session ID. */
  sid: string;
  /** User's assigned role. */
  role: string;
  /** Subscription / tenant ID (may be `null` for single-tenant deployments). */
  subscriptionId: string | null;
  /** List of location IDs the user has access to. */
  locationIds: string[];
  /** Workstation fingerprint the token is bound to. */
  wfp: string;
  /** Token type — always `"offline"`. */
  typ: 'offline';
  /** JWT unique identifier (used for revocation tracking). */
  jti: string;
  /** Issued-at timestamp (Unix epoch seconds). */
  iat: number;
  /** Expiration timestamp (Unix epoch seconds). */
  exp: number;
}

// ---------------------------------------------------------------------------
// Credential cache
// ---------------------------------------------------------------------------

/**
 * A server-issued encrypted credential blob that allows the POS to
 * re-authenticate offline without requiring the user's password.
 *
 * The actual CVK (Client Verification Key) decryption happens client-side
 * and is outside the scope of this type — this entry only tracks the
 * opaque encrypted blob and its metadata.
 */
export interface CredentialCacheEntry {
  /** User ID this cache entry belongs to. */
  userId: string;

  /** Opaque encrypted credential blob issued by the server. */
  encryptedCredentials: string;

  /**
   * Fingerprint of the key used to encrypt the blob.  The client must
   * have a matching key provisioned to decrypt.
   */
  keyFingerprint: string;

  /** When this cache entry expires and must be refreshed. */
  expiresAt: Date;

  /** Monotonically increasing version — increments every time the server rotates keys. */
  version: number;
}

// ---------------------------------------------------------------------------
// Revocation list
// ---------------------------------------------------------------------------

/** A single entry in the local JWT revocation list. */
export interface RevocationListEntry {
  /** The `jti` (JWT ID) that was revoked. */
  jti: string;

  /** When the revocation was recorded (server timestamp). */
  revokedAt: Date;

  /** Server-provided reason for revocation. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Login result
// ---------------------------------------------------------------------------

/** Successful result of an offline-first login flow. */
export interface OfflineLoginResult {
  /** The locally-established offline session. */
  session: OfflineSession;
}

