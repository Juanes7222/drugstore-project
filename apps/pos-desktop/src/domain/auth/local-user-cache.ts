/**
 * Local user cache — persists basic user info for the login avatar grid
 * and QuickSwitch when the server is unreachable or the current session
 * lacks the role to list all users.
 *
 * ## How the cache is populated
 *
 * 1. **Full-list fetch** — When a user with an active session calls
 *    `authService.listUsers()` (e.g. from QuickSwitch or the user
 *    management page), the returned list is cached.
 *
 * 2. **Single-login append** — After a successful login the authenticated
 *    user's own profile is appended to the cache so the same device
 *    remembers who has logged in before.
 *
 * ## How it is consumed
 *
 * - **Login page** — Reads the cache on mount. If the cache is empty
 *   (first ever use), the avatar grid is replaced by the manual login
 *   form. Once any user logs in, their profile is cached and the grid
 *   becomes available on the next visit.
 * - **QuickSwitch** — Tries the server first (because the session exists),
 *   falls back to the cache on 403 / network error.
 *
 * ## Storage
 *
 * Uses `secure-storage` (localStorage with basic obfuscation in the
 * renderer, Tauri stronghold in the future) so the cache survives app
 * restarts and is scoped to the device.
 */

import type { LocalUserInfo } from './local-users';
import { createSecureStorage } from '../../infrastructure/secure-storage';

const CACHE_KEY = 'local_user_cache';
const MAX_CACHED_USERS = 50;

// ---------------------------------------------------------------------------
// In-memory read-through cache — avoids deserialising on every access
// ---------------------------------------------------------------------------

let cachedUsers: LocalUserInfo[] | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load cached user info from secure storage.
 *
 * Returns an empty array when no cache exists (first-ever use on this
 * device or after a manual clear).
 */
export async function loadCachedUsers(): Promise<LocalUserInfo[]> {
  if (cachedUsers !== null) return cachedUsers;

  try {
    const storage = createSecureStorage();
    const raw = await storage.getItem(CACHE_KEY);
    if (!raw) {
      cachedUsers = [];
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      cachedUsers = [];
      return [];
    }
    // Basic structural validation — silently drop malformed entries
    cachedUsers = parsed.filter(
      (u): u is LocalUserInfo =>
        typeof u === 'object' &&
        u !== null &&
        typeof (u as LocalUserInfo).id === 'string' &&
        typeof (u as LocalUserInfo).displayName === 'string' &&
        typeof (u as LocalUserInfo).username === 'string',
    );
    return cachedUsers;
  } catch {
    // Corrupt cache — reset
    cachedUsers = [];
    return [];
  }
}

/**
 * Replace the entire cache with a fresh list of users.
 *
 * Typically called after a successful `authService.listUsers()` call.
 */
export async function cacheUsers(users: LocalUserInfo[]): Promise<void> {
  const clamped = users.slice(0, MAX_CACHED_USERS);
  cachedUsers = clamped;
  try {
    const storage = createSecureStorage();
    await storage.setItem(CACHE_KEY, JSON.stringify(clamped));
  } catch {
    // Non-fatal — the in-memory cache is still valid for the current session
  }
}

/**
 * Add a single user to the cache (idempotent — updates by id).
 *
 * Called after a successful login so the profile appears in the avatar
 * grid on subsequent visits.
 */
export async function cacheUser(user: LocalUserInfo): Promise<void> {
  const current = await loadCachedUsers();
  const existingIndex = current.findIndex((u) => u.id === user.id);
  if (existingIndex >= 0) {
    // Update in place
    current[existingIndex] = user;
  } else {
    current.push(user);
  }
  await cacheUsers(current);
}

/**
 * Remove a specific user from the cache by id.
 */
export async function removeCachedUser(userId: string): Promise<void> {
  const current = await loadCachedUsers();
  const filtered = current.filter((u) => u.id !== userId);
  if (filtered.length < current.length) {
    await cacheUsers(filtered);
  }
}

/**
 * Clear the entire cache (e.g. on logout of the primary account).
 */
export async function clearUserCache(): Promise<void> {
  cachedUsers = [];
  try {
    const storage = createSecureStorage();
    await storage.removeItem(CACHE_KEY);
  } catch {
    // Non-fatal
  }
}

/**
 * Invalidate the in-memory cache so the next `loadCachedUsers()` call
 * re-reads from storage. Useful in tests.
 */
export function resetUserCache(): void {
  cachedUsers = null;
}
