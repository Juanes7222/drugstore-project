/**
 * User-identity pull synchronizer for the POS desktop app.
 *
 * Downloads the minimal login-identities list from the server
 * (`GET /users/login-identities`, reachable by every authenticated POS role)
 * and mirrors it into the two stores the login avatar grid reads:
 *
 * 1. The `secure-storage` avatar-grid cache (`local_user_cache`), via
 *    `cacheUsers()` — the grid's primary source.
 * 2. Identity-only rows in the local PGlite `User` table, via
 *    `upsertUserIdentity()` — report name resolution. These rows carry an
 *    empty credential hash and can never authenticate locally.
 *
 * ## Shape
 * Follows the same fetch/apply split as `ClientPullService`: the scheduler
 * runs `fetchUserIdentities()` unlocked (network only) and
 * `applyUserIdentities()` under the PGlite write lock.
 *
 * ## Safety rules
 * - Safe to call when offline — returns early without throwing.
 * - An empty server response never wipes the grid cache: some sessions
 *   (e.g. SAAS_ADMIN without a subscription) legitimately receive
 *   `{ users: [] }`, and replacing a populated grid with nothing would hide
 *   every user from the next pre-login screen.
 * - Credential hashes never cross this boundary — the server exposes only
 *   `hasPin`/`hasPassword` presence flags, mapped through the shared
 *   `mapServerUserToLocalUserInfo` so there is a single identity shape.
 */

import { isOnline } from '../../common/is-online';
import { setUsersLastSyncedAt } from '../../common/sync-metadata';
import type { SyncHttpClient } from '../catalog/catalog-sync.service';
import { UserPullHttpException } from './exceptions';
import { cacheUsers } from './local-user-cache';
import { mapServerUserToLocalUserInfo } from './local-users';
import { createUserCacheService } from './user-cache.service';

// ---------------------------------------------------------------------------
// Config & factory
// ---------------------------------------------------------------------------

export interface UserPullConfig {
  /** Server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
  /** Optional override of the HTTP client (for testing). */
  httpClient?: SyncHttpClient;
  /** Optional auth token for protected endpoints. */
  accessToken?: string;
  /** Long-lived offline token fallback (X-Offline-Token). */
  offlineToken?: string;
}

export const createUserPullService = (
  config: UserPullConfig,
): UserPullService => {
  return new UserPullService(config);
};

// ---------------------------------------------------------------------------
// Row shape
// ---------------------------------------------------------------------------

/** Minimal identity the server's `GET /users/login-identities` returns. */
export interface LoginIdentityRow {
  id: string;
  displayName?: string;
  fullName?: string;
  username?: string;
  role: string;
  avatarUrl?: string | null;
  avatarColor?: string | null;
  hasPin?: boolean;
  hasPassword?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class UserPullService {
  private readonly http: SyncHttpClient;
  private readonly baseUrl: string;
  private readonly accessToken?: string;
  private readonly offlineToken?: string;

  constructor(config: UserPullConfig) {
    this.http = config.httpClient ?? defaultHttpClient;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.accessToken = config.accessToken;
    this.offlineToken = config.offlineToken;
  }

  /**
   * Pull user identities from the server into the local mirrors.
   *
   * Safe to call when offline — returns early without throwing.
   */
  async pullUserIdentities(): Promise<void> {
    if (!isOnline()) return;
    const rows = await this.fetchUserIdentities();
    await this.applyUserIdentities(rows);
  }

  /**
   * Network phase: fetch the identity list from
   * `GET /users/login-identities`. No database access — safe to run
   * without the PGlite write lock.
   */
  async fetchUserIdentities(): Promise<LoginIdentityRow[]> {
    const authHeaders = this.buildAuthHeaders();
    const response = await this.http.get<{ users: LoginIdentityRow[] }>(
      `${this.baseUrl}/users/login-identities?limit=100`,
      authHeaders,
    );
    return response.users ?? [];
  }

  /**
   * Apply phase: refresh the avatar-grid cache and upsert identity rows,
   * then record `usersLastSyncedAt`. Must run under the PGlite write lock
   * when called from the scheduler (the upserts touch the local database).
   */
  async applyUserIdentities(rows: LoginIdentityRow[]): Promise<void> {
    if (rows.length === 0) {
      setUsersLastSyncedAt(new Date().toISOString());
      return;
    }

    const mapped = rows.map(mapServerUserToLocalUserInfo);
    await cacheUsers(mapped);

    const identityCache = createUserCacheService();
    for (const user of mapped) {
      try {
        await identityCache.upsertUserIdentity({
          id: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          role: user.role,
        });
      } catch {
        // Per-row best-effort — one malformed identity must not discard
        // the rest of the mirror.
      }
    }

    setUsersLastSyncedAt(new Date().toISOString());
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    if (this.offlineToken) headers['X-Offline-Token'] = this.offlineToken;
    return headers;
  }
}

// ---------------------------------------------------------------------------
// Default HTTP client
// ---------------------------------------------------------------------------

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new UserPullHttpException(url, response.status, await response.text());
    }
    return response.json() as Promise<T>;
  },
};
