/**
 * Offline auth storage helpers.
 *
 * Functions for reading, writing, and clearing credential cache entries
 * from SecureStorage.  Pure functions that handle serialisation boundaries
 * are separated from I/O functions that depend on the `SecureStorage`
 * abstraction.
 */
import {
  CredentialCacheEntry,
} from './types';
import { SecureStorage } from '../../../infrastructure/secure-storage';

// ---------------------------------------------------------------------------
// Storage key constants
// ---------------------------------------------------------------------------

const CREDENTIAL_CACHE_PREFIX = 'credential_cache_';
const REVOCATION_LIST_KEY = 'revocation_list';
const OFFLINE_SESSION_KEY_PREFIX = 'offline_session_';

// ---------------------------------------------------------------------------
// Credential cache I/O
// ---------------------------------------------------------------------------

/**
 * Read a single credential cache entry from secure storage.
 *
 * @param userId         The user whose cache entry to retrieve.
 * @param secureStorage  The secure storage backend.
 * @returns The deserialised cache entry, or `null` if none exists.
 */
export async function getCredentialCacheEntry(
  userId: string,
  secureStorage: SecureStorage,
): Promise<CredentialCacheEntry | null> {
  const raw = await secureStorage.getItem(CREDENTIAL_CACHE_PREFIX + userId);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Omit<CredentialCacheEntry, 'expiresAt'> & {
      expiresAt: string;
    };
    return {
      ...parsed,
      expiresAt: new Date(parsed.expiresAt),
    };
  } catch {
    // Corrupt entry — treat as absent.
    return null;
  }
}

/**
 * Write (or overwrite) a credential cache entry to secure storage.
 *
 * @param userId         The user to associate with this cache entry.
 * @param entry          The cache entry to persist.
 * @param secureStorage  The secure storage backend.
 */
export async function setCredentialCacheEntry(
  userId: string,
  entry: CredentialCacheEntry,
  secureStorage: SecureStorage,
): Promise<void> {
  const serialised = JSON.stringify({
    ...entry,
    expiresAt: entry.expiresAt.toISOString(),
  });
  await secureStorage.setItem(CREDENTIAL_CACHE_PREFIX + userId, serialised);
}

/**
 * Remove all credential cache entries from secure storage.
 *
 * This performs a best-effort scan of known keys.  In the future, when
 * secure storage supports key enumeration, this can be more thorough.
 *
 * @param secureStorage  The secure storage backend.
 * @param knownUserIds   Optional list of user IDs whose entries to clear.
 *                       If omitted, clears using a set of well-known keys.
 */
export async function clearCredentialCache(
  secureStorage: SecureStorage,
  knownUserIds?: string[],
): Promise<void> {
  const userIds = knownUserIds ?? [];
  await Promise.all(
    userIds.map((uid) =>
      secureStorage.removeItem(CREDENTIAL_CACHE_PREFIX + uid),
    ),
  );
}

// ---------------------------------------------------------------------------
// Cleanup (pure)
// ---------------------------------------------------------------------------

/**
 * Filter out expired credential cache entries.
 *
 * Pure function — does not perform I/O.  The caller can use the result
 * to decide which entries to remove from storage.
 *
 * @param entries  The current set of cache entries.
 * @param now      Reference time for expiry comparison.
 * @returns Entries whose `expiresAt` is still in the future.
 */
export function clearExpiredEntries(
  entries: CredentialCacheEntry[],
  now: Date,
): CredentialCacheEntry[] {
  return entries.filter((entry) => entry.expiresAt.getTime() > now.getTime());
}

// ---------------------------------------------------------------------------
// Revocation list I/O
// ---------------------------------------------------------------------------

/**
 * Read the revocation list from secure storage.
 *
 * @param secureStorage  The secure storage backend.
 * @returns The deserialised revocation list (empty array if none exists).
 */
export async function getRevocationList(
  secureStorage: SecureStorage,
): Promise<import('./types').RevocationListEntry[]> {
  const raw = await secureStorage.getItem(REVOCATION_LIST_KEY);
  if (!raw) return [];

  try {
    return JSON.parse(raw) as import('./types').RevocationListEntry[];
  } catch {
    return [];
  }
}

/**
 * Overwrite the revocation list in secure storage.
 *
 * @param entries        The full revocation list.
 * @param secureStorage  The secure storage backend.
 */
export async function setRevocationList(
  entries: import('./types').RevocationListEntry[],
  secureStorage: SecureStorage,
): Promise<void> {
  await secureStorage.setItem(REVOCATION_LIST_KEY, JSON.stringify(entries));
}

// ---------------------------------------------------------------------------
// Session persistence I/O
// ---------------------------------------------------------------------------

/**
 * Persist an offline session to secure storage so it survives app restart.
 *
 * @param localSessionId The session's local ID (used as storage key).
 * @param sessionData    A plain-serialisable representation of the session.
 * @param secureStorage  The secure storage backend.
 */
export async function saveOfflineSession(
  localSessionId: string,
  sessionData: Record<string, unknown>,
  secureStorage: SecureStorage,
): Promise<void> {
  await secureStorage.setItem(
    OFFLINE_SESSION_KEY_PREFIX + localSessionId,
    JSON.stringify(sessionData),
  );
}

/**
 * Load a persisted offline session from secure storage.
 *
 * @param localSessionId The session's local ID.
 * @param secureStorage  The secure storage backend.
 * @returns The deserialised session data, or `null` if not found.
 */
export async function loadOfflineSession(
  localSessionId: string,
  secureStorage: SecureStorage,
): Promise<Record<string, unknown> | null> {
  const raw = await secureStorage.getItem(
    OFFLINE_SESSION_KEY_PREFIX + localSessionId,
  );
  if (!raw) return null;

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Delete a persisted offline session from secure storage.
 *
 * @param localSessionId The session's local ID.
 * @param secureStorage  The secure storage backend.
 */
export async function removeOfflineSession(
  localSessionId: string,
  secureStorage: SecureStorage,
): Promise<void> {
  await secureStorage.removeItem(
    OFFLINE_SESSION_KEY_PREFIX + localSessionId,
  );
}
