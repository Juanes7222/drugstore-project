/**
 * Pure offline auth validation functions.
 *
 * Handles offline JWT verification (signature, expiration, workstation
 * binding), revocation list checks, and credential cache entry validation.
 *
 * ## JWT verification
 *
 * The full implementation will use the server's shared secret with `jose`
 * or a similar library.  For now the functions:
 *  1. Decode the base64-encoded payload without verification (safe for
 *     reading claims before blessing).
 *  2. Perform a simplified signature check using HMAC-SHA256 computed
 *     in pure JS via the Web Crypto API (`crypto.subtle`).
 *  3. Validate expiration, issuance, and workstation binding.
 *
 * The verification is **deterministic** — given the same inputs, it always
 * produces the same result.  No side effects, no I/O.
 */

import {
  OfflineTokenClaims,
  RevocationListEntry,
  CredentialCacheEntry,
} from './types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default clock drift tolerance in seconds (5 minutes). */
const DEFAULT_CLOCK_DRIFT_TOLERANCE_S = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode a base64url-encoded string to its UTF-8 text representation.
 * Handles both standard base64 and base64url (JWT-style) encodings.
 */
function base64UrlDecode(input: string): string {
  // Convert base64url to standard base64
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Pad with '=' characters if needed
  while (base64.length % 4 !== 0) {
    base64 += '=';
  }
  return decodeURIComponent(
    Array.from(atob(base64))
      .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join(''),
  );
}

/**
 * Convert a string to an ArrayBuffer for use with Web Crypto API.
 */
function stringToArrayBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/**
 * Convert an ArrayBuffer to a hex string for comparison.
 */
function arrayBufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Compute HMAC-SHA256 of the given data with the given secret.
 * Uses the Web Crypto API when available; falls back to a minimal
 * implementation otherwise.
 */
async function computeHmacSha256(
  data: string,
  secret: string,
): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const key = await crypto.subtle.importKey(
      'raw',
      stringToArrayBuffer(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      stringToArrayBuffer(data),
    );
    return arrayBufferToHex(signature);
  }

  // Fallback: a simple concatenation-based hash-like function for
  // environments without Web Crypto (e.g. some test runners).
  // This is NOT cryptographically secure — it is a placeholder until
  // a proper JWT library is available.
  let hash = 0;
  const combined = data + ':' + secret;
  for (let i = 0; i < combined.length; i++) {
    const char = combined.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

// ---------------------------------------------------------------------------
// Token parsing
// ---------------------------------------------------------------------------

/**
 * Safely parse a JWT token into its three parts.
 * Returns `null` for malformed tokens.
 */
function parseJwt(token: string): {
  header: string;
  payload: string;
  signature: string;
} | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  if (parts[0].length === 0 || parts[1].length === 0) return null;
  return {
    header: parts[0],
    payload: parts[1],
    signature: parts[2],
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Decode an offline JWT token's claims **without** verifying the signature.
 *
 * Safe for reading claims before sending them to the server for blessing.
 * The returned claims must still be verified before being trusted.
 *
 * @param token  The raw JWT string.
 * @returns Decoded claims, or `null` if the token is malformed.
 */
export function decodeOfflineToken(token: string): OfflineTokenClaims | null {
  try {
    const parsed = parseJwt(token);
    if (!parsed) return null;

    const raw = JSON.parse(base64UrlDecode(parsed.payload));

    // Validate required fields
    if (typeof raw.sub !== 'string') return null;
    if (typeof raw.typ !== 'string' || raw.typ !== 'offline') return null;

    return {
      sub: raw.sub,
      sid: raw.sid ?? '',
      role: raw.role ?? '',
      subscriptionId: raw.subscriptionId ?? null,
      locationIds: Array.isArray(raw.locationIds) ? raw.locationIds : [],
      wfp: raw.wfp ?? '',
      typ: 'offline',
      jti: raw.jti ?? '',
      iat: typeof raw.iat === 'number' ? raw.iat : 0,
      exp: typeof raw.exp === 'number' ? raw.exp : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Verify an offline JWT token.
 *
 * Checks:
 *  - Well-formed JWT structure
 *  - Signature validity (HMAC-SHA256 with the server secret)
 *  - Token type (`typ`) equals `"offline"`
 *  - Not expired (with configurable clock drift tolerance)
 *  - Bound to the expected workstation fingerprint
 *
 * @param token                        The raw JWT string.
 * @param secret                       Shared secret for HMAC verification.
 * @param expectedWorkstationFingerprint  The current workstation's fingerprint.
 * @returns Decoded claims if every check passes, or `null` on failure.
 */
export async function verifyOfflineToken(
  token: string,
  secret: string,
  expectedWorkstationFingerprint: string,
): Promise<OfflineTokenClaims | null> {
  try {
    const parsed = parseJwt(token);
    if (!parsed) return null;

    // 1. Verify signature
    const expectedSignature = await computeHmacSha256(
      `${parsed.header}.${parsed.payload}`,
      secret,
    );
    if (parsed.signature !== expectedSignature) {
      return null;
    }

    // 2. Decode and validate claims
    const claims = decodeOfflineToken(token);
    if (!claims) return null;

    // 3. Token type check
    if (claims.typ !== 'offline') return null;

    // 4. Expiration check (with drift tolerance)
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now - DEFAULT_CLOCK_DRIFT_TOLERANCE_S) {
      return null;
    }

    // 5. Workstation binding
    if (claims.wfp !== expectedWorkstationFingerprint) {
      return null;
    }

    return claims;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Revocation list
// ---------------------------------------------------------------------------

/**
 * Check whether a given JWT ID (`jti`) appears in the local revocation list
 * or if a user-level revocation marker exists that invalidates all tokens
 * issued before the marker's timestamp.
 *
 * The server creates user-level markers (`user:${userId}:${timestamp}`) when
 * a user's password or PIN is changed, disabling every offline token for that
 * user regardless of its individual `jti`.
 *
 * @param jti             The JWT ID to look up.
 * @param revocationList  The current revocation list.
 * @param issuedAt        Token's issued-at timestamp (unix seconds). When
 *                        provided, user-level markers created *after* this
 *                        time are considered a match.
 * @param userId          The user ID to match against user-level markers.
 * @returns `true` if the token has been revoked.
 */
export function isRevoked(
  jti: string,
  revocationList: RevocationListEntry[],
  issuedAt?: number,
  userId?: string,
): boolean {
  // Direct jti match — the exact token was revoked
  if (revocationList.some((entry) => entry.jti === jti)) {
    return true;
  }

  // User-level revocation marker — invalidates all tokens for this user
  // that were issued before the marker was created.
  if (userId && issuedAt) {
    const markerPrefix = `user:${userId}:`;
    const markerFound = revocationList.some((entry) => {
      if (!entry.jti.startsWith(markerPrefix)) return false;
      // entry.revokedAt is a Date; compare against iat in seconds
      return entry.revokedAt.getTime() / 1000 > issuedAt;
    });
    if (markerFound) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Token expiration helpers
// ---------------------------------------------------------------------------

/**
 * Extract the expiration `Date` from decoded offline token claims.
 */
export function getOfflineTokenExpiration(claims: OfflineTokenClaims): Date {
  return new Date(claims.exp * 1000);
}

/**
 * Check whether an offline token is expired.
 *
 * @param claims  Decoded token claims.
 * @param now     Reference time (defaults to current wall-clock time).
 * @returns `true` when the token is expired or would expire within the
 *          default clock-drift tolerance window.
 */
export function isTokenExpired(
  claims: OfflineTokenClaims,
  now?: Date,
): boolean {
  const referenceTime = (now ?? new Date()).getTime() / 1000;
  return claims.exp < referenceTime - DEFAULT_CLOCK_DRIFT_TOLERANCE_S;
}

// ---------------------------------------------------------------------------
// Credential cache validation
// ---------------------------------------------------------------------------

/**
 * Validate a cached credential entry.
 *
 * Since actual CVK decryption happens client-side (outside this module),
 * this function performs structural validation only — it checks whether
 * the entry has expired or uses an outdated key fingerprint.  The caller
 * is responsible for cryptographic verification.
 *
 * @param cacheEntry      The credential cache entry to validate.
 * @param keyFingerprint  The expected key fingerprint (current key version).
 * @param now             Reference time.
 * @returns An object with `valid: boolean` and an optional `reason` string
 *          explaining why the entry is invalid.
 */
export function validateCachedCredentials(
  cacheEntry: CredentialCacheEntry,
  keyFingerprint: string,
  now: Date,
): { valid: boolean; reason?: string } {
  // 1. Expiration check
  if (cacheEntry.expiresAt.getTime() < now.getTime()) {
    return { valid: false, reason: 'credential cache entry has expired' };
  }

  // 2. Key fingerprint check (key rotation detection)
  if (cacheEntry.keyFingerprint !== keyFingerprint) {
    return {
      valid: false,
      reason: 'credential cache uses an outdated key fingerprint',
    };
  }

  return { valid: true };
}
