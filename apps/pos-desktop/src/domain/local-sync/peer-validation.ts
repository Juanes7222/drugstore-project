/**
 * Peer validation logic.
 *
 * Validates that a discovered peer belongs to the same location
 * by comparing the auth token hash from the mDNS TXT record against
 * the expected hash derived from the local network key.
 *
 * The expected hash is SHA-256 hex of the local network key, computed on
 * the Rust side by `compute_auth_token_hash()` (`src-tauri/src/
 * mdns_discovery.rs`) and exposed to TypeScript through the discovered
 * peer records. This module deliberately does NOT compute the hash itself:
 * a previous revision shipped a synchronous stub that always returned `''`,
 * which could never match the real Rust hash and rejected every peer.
 * Callers pass the precomputed value in.
 */

export interface PeerValidationResult {
  isValid: boolean;
  reason?: 'WRONG_LOCATION' | 'INVALID_HASH' | 'OUTDATED_VERSION' | 'SELF';
}

const MIN_SUPPORTED_VERSION = '0.1.0';

/**
 * Validate that a discovered peer can participate in the local network.
 *
 * @param peerAuthTokenHash - The auth token hash from the peer's mDNS TXT record.
 * @param expectedHash - Precomputed SHA-256 hex of our local network key
 *   (Rust `compute_auth_token_hash`). Pass null when this station has no
 *   network key configured.
 * @param peerAppVersion - The peer's app version from mDNS.
 * @param isSelf - Whether this is our own advertisement.
 */
export function isValidPeer(
  peerAuthTokenHash: string | undefined,
  expectedHash: string | null,
  peerAppVersion: string | undefined,
  isSelf: boolean,
): PeerValidationResult {
  if (isSelf) {
    return { isValid: false, reason: 'SELF' };
  }

  if (!expectedHash) {
    return {
      isValid: false,
      reason: 'WRONG_LOCATION',
    };
  }

  if (!peerAuthTokenHash) {
    return { isValid: false, reason: 'INVALID_HASH' };
  }

  // The peer belongs to the same location when its advertised hash matches
  // the hash of our own local network key.
  if (peerAuthTokenHash !== expectedHash) {
    return {
      isValid: false,
      reason: 'WRONG_LOCATION',
    };
  }

  // Version check.
  if (peerAppVersion && !isVersionSupported(peerAppVersion)) {
    return {
      isValid: false,
      reason: 'OUTDATED_VERSION',
    };
  }

  return { isValid: true };
}

/**
 * Check if the peer's app version is >= the minimum supported version.
 */
function isVersionSupported(version: string): boolean {
  const parts = version.split('.').map(Number);
  const minParts = MIN_SUPPORTED_VERSION.split('.').map(Number);

  for (let i = 0; i < Math.max(parts.length, minParts.length); i++) {
    const v = parts[i] ?? 0;
    const m = minParts[i] ?? 0;
    if (v > m) return true;
    if (v < m) return false;
  }
  return true;
}
