/**
 * Local user info types and server-response mappers.
 *
 * Users from the local PGlite cache and from the server API are both mapped
 * to the same `LocalUserInfo` shape for the avatar grid.  No dual identity.
 */

import type { RoleType } from '@pharmacy/shared-types';
import type { UserData } from './local-types';

export interface LocalUserInfo {
  id: string;
  displayName: string;
  role: RoleType;
  avatarUrl: string | null;
  avatarColor: string | null;
  username: string;
}

/**
 * Map a local PGlite User replica to the `LocalUserInfo` avatar-grid shape.
 */
export function mapLocalUserDataToLocalUserInfo(
  user: UserData,
): LocalUserInfo {
  return {
    id: user.id,
    displayName: user.displayName,
    role: user.role as RoleType,
    avatarUrl: null,
    avatarColor: null,
    username: user.username,
  };
}

/**
 * Map a user from a server API response to `LocalUserInfo`.
 *
 * Works with `/users` list items and `/auth/login` response's `user` field.
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
