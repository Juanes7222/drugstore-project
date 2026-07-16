/**
 * Local user info types and server-response mappers.
 *
 * The actual user data is now loaded from:
 * - The local user cache (`local-user-cache.ts`) when offline
 * - The server via `authService.listUsers()` when a session exists
 *
 * No hardcoded seed data lives here. The login page falls back to the
 * manual form when the cache is empty, which happens only on first-ever
 * use of the app on a device.
 */

import type { RoleType } from '@pharmacy/shared-types';

export interface LocalUserInfo {
  id: string;
  displayName: string;
  role: RoleType;
  avatarUrl: string | null;
  avatarColor: string | null;
  username: string;
}

/**
 * Map a user object from a server API response to the POS `LocalUserInfo`
 * shape expected by `AvatarGrid` and `QuickSwitch`.
 *
 * Works with:
 * - `/users` response items (full user list)
 * - `/auth/login` response's `user` field (single authenticated user)
 */
export function mapServerUserToLocalUserInfo(
  serverUser: {
    id: string;
    displayName?: string;
    fullName?: string;
    role: string;
    avatarUrl?: string | null;
    avatarColor?: string | null;
    username?: string;
  },
): LocalUserInfo {
  return {
    id: serverUser.id,
    displayName: serverUser.displayName ?? serverUser.fullName ?? '',
    role: serverUser.role as RoleType,
    avatarUrl: serverUser.avatarUrl ?? null,
    avatarColor: serverUser.avatarColor ?? null,
    username: serverUser.username ?? '',
  };
}
