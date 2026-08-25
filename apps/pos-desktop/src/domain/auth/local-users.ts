/**
 * Local user info types and server-response mappers.
 *
 * Users from the local avatar-grid cache and from the server API are both
 * mapped to the same `LocalUserInfo` shape for the login grid. No dual
 * identity.
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
  /**
   * Whether the server holds a PIN credential for this user.
   * `undefined` = unknown (entry cached before the server exposed flags).
   */
  hasPin?: boolean;
  /** Whether the server holds a password credential. Same caveat as hasPin. */
  hasPassword?: boolean;
}

/** Minimal server payload shape the credential flags can be derived from. */
export interface ServerCredentialInfo {
  /** Explicit booleans from the server (preferred when present). */
  hasPin?: boolean;
  hasPassword?: boolean;
  /** Fallback signal when the server predates the explicit flags. */
  authMethod?: string | null;
}

/**
 * Derive PIN/password availability from a server user payload.
 *
 * Prefers the explicit booleans; falls back to `authMethod` for older
 * servers. Returns empty object (both unknown) when neither is available —
 * callers must treat unknown as "fall back to legacy heuristics", never as
 * "definitely absent".
 */
export function deriveCredentialFlags(
  serverUser: ServerCredentialInfo,
): Pick<LocalUserInfo, 'hasPin' | 'hasPassword'> {
  if (
    serverUser.hasPin !== undefined ||
    serverUser.hasPassword !== undefined
  ) {
    return {
      hasPin: serverUser.hasPin,
      hasPassword: serverUser.hasPassword,
    };
  }

  switch (serverUser.authMethod) {
    case 'PIN_ONLY':
      return { hasPin: true, hasPassword: false };
    case 'PASSWORD_ONLY':
    case 'PASSWORD_TOTP':
      return { hasPin: false, hasPassword: true };
    case 'OAUTH_GOOGLE':
      return { hasPin: false, hasPassword: false };
    default:
      return {};
  }
}

/**
 * Map a local PGlite User replica to the `LocalUserInfo` avatar-grid shape.
 * The replica carries no credential metadata, so the flags stay unset.
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
 * Works with `/users` list items and `/auth/login*` response `user` fields.
 */
export function mapServerUserToLocalUserInfo(
  serverUser: ServerCredentialInfo & {
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
    ...deriveCredentialFlags(serverUser),
  };
}
