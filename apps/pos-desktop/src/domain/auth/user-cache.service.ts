/**
 * User cache service — manages the local PGlite replica of User entities
 * with password-based authentication via PBKDF2-SHA-512.
 *
 * ## Single identity rule
 *
 * This is NOT a separate user registry.  Every User stored here has the
 * same UUID it will have on the server.  Credentials are verified against
 * the local hash first; the server only updates, revokes, or confirms.
 *
 * ## Password hashing
 *
 * Uses Web Crypto API (`crypto.subtle`) with PBKDF2-SHA-512, 600 000
 * iterations, random 16-byte salt.  Stored format:
 *
 *   `pbkdf2-sha512:600000:<salt-base64url>:<hash-hex>`
 *
 * Self-describing so parameters can evolve without migration.
 *
 * ## Rate limiting
 *
 * 5 consecutive failures → 5-minute lock.
 * 10 consecutive failures → admin unlock required.
 *
 * @module
 */

import { getLocalDatabase } from '../../infrastructure/local-database';
import { DomainError } from '../../common/domain-error';
import type {
  UserData,
  UserStatus,
  PasswordVerificationResult,
} from './local-types';

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export class UserNotFoundException extends DomainError {
  constructor(userId: string) {
    super('USER_NOT_FOUND', `User not found: ${userId}`);
  }
}

export class UserAlreadyExistsException extends DomainError {
  constructor(username: string) {
    super('USER_ALREADY_EXISTS', `User already exists: ${username}`);
  }
}

export class UserLockedException extends DomainError {
  constructor(lockedUntil: Date) {
    super(
      'USER_LOCKED',
      `User is locked until ${lockedUntil.toISOString()}`,
    );
  }
}

export class UserDisabledException extends DomainError {
  constructor() {
    super('USER_DISABLED', 'User account is disabled');
  }
}

export class PasswordInvalidException extends DomainError {
  constructor() {
    super('PASSWORD_INVALID', 'Incorrect password');
  }
}

export class UserMaxAttemptsException extends DomainError {
  constructor() {
    super(
      'USER_MAX_ATTEMPTS',
      'Maximum failed attempts reached. Contact an administrator.',
    );
  }
}

export class WebCryptoUnavailableException extends DomainError {
  constructor() {
    super(
      'WEB_CRYPTO_UNAVAILABLE',
      'Web Crypto API is not available in this environment',
    );
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PBKDF2 iteration count — OWASP 2023 recommended minimum for SHA-512. */
const PBKDF2_ITERATIONS = 600_000;
const SALT_BYTE_LENGTH = 16;
const HASH_ALGORITHM = 'SHA-512';
const KEY_LENGTH = 64; // 512 bits

const LOCK_THRESHOLD_ATTEMPTS = 5;
const MAX_ATTEMPTS = 10;
const LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// ---------------------------------------------------------------------------
// Service interface
// ---------------------------------------------------------------------------

export interface UserCacheService {
  /** Create a new local User replica. */
  createUser(params: {
    id: string;
    username: string;
    displayName: string;
    role: string;
    password: string;
    createdLocally: boolean;
  }): Promise<UserData>;

  /** Find user by user ID. */
  getUser(userId: string): Promise<UserData | null>;

  /** Create or refresh a User row's identity (id, username, displayName,
   *  role) without touching credentials.  Rows created this way cannot
   *  authenticate locally — they exist so reports and the avatar grid can
   *  resolve names for users who authenticated on this device (or were
   *  listed through QuickSwitch).  Best-effort: callers swallow failures. */
  upsertUserIdentity(params: {
    id: string;
    username: string;
    displayName: string;
    role: string;
  }): Promise<void>;

  /** Find user by username. */
  getUserByUsername(username: string): Promise<UserData | null>;

  /** List all non-deleted users. */
  getUsers(): Promise<UserData[]>;

  /** Verify a password against the stored hash. */
  verifyPassword(userId: string, password: string): Promise<PasswordVerificationResult>;

  /** Update the stored password hash + increment version. */
  updatePassword(userId: string, newPassword: string): Promise<void>;

  /** Set user status (ACTIVE / DISABLED). */
  setStatus(userId: string, status: UserStatus): Promise<void>;

  /** Reset failed-attempt counter and clear lock. */
  unlockUser(userId: string): Promise<void>;

  /** Record a successful login (updates lastLoginAt). */
  recordLogin(userId: string): Promise<void>;

  /** Soft-delete a user. */
  deleteUser(userId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Password hashing helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(buffer: ArrayBuffer | ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<ArrayBufferLike> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveBits'],
  );

  return crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGORITHM,
    },
    keyMaterial,
    KEY_LENGTH * 8,
  );
}

function formatHash(salt: Uint8Array, hash: ArrayBufferLike): string {
  const hashHex = Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `pbkdf2-sha512:${PBKDF2_ITERATIONS}:${base64UrlEncode(salt.buffer)}:${hashHex}`;
}

async function hashPassword(password: string): Promise<string> {
  if (!crypto?.subtle) {
    throw new WebCryptoUnavailableException();
  }
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const hash = await deriveKey(password, salt);
  return formatHash(salt, hash);
}

async function verifyHash(
  password: string,
  stored: string,
): Promise<boolean> {
  if (!crypto?.subtle) {
    throw new WebCryptoUnavailableException();
  }

  const parts = stored.split(':');
  if (parts.length < 4) return false;

  const [, algo, iterationsStr, saltB64] = parts;
  const hashHexFromDb = parts.slice(3).join(':');

  // Only support the current algorithm
  if (algo !== 'pbkdf2-sha512') return false;

  const iterations = parseInt(iterationsStr, 10);
  if (isNaN(iterations) || iterations <= 0) return false;

  const saltBytes = base64UrlDecode(saltB64);
  const derived = await deriveKey(password, saltBytes);
  const derivedHex = Array.from(new Uint8Array(derived))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Constant-time comparison
  if (derivedHex.length !== hashHexFromDb.length) return false;
  let diff = 0;
  for (let i = 0; i < derivedHex.length; i++) {
    diff |= derivedHex.charCodeAt(i) ^ hashHexFromDb.charCodeAt(i);
  }
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Row → UserData mapper
// ---------------------------------------------------------------------------

function rowToUserData(row: Record<string, unknown>): UserData {
  return {
    id: row.id as string,
    username: row.username as string,
    displayName: row.display_name as string ?? row.displayName as string,
    role: row.role as string,
    status: (row.status as string) as UserStatus,
    passwordVersion: (row.password_version ?? row.passwordVersion ?? 1) as number,
    credentialMode: (row.credential_mode ?? row.credentialMode ?? 'PASSWORD') as CredentialMode,
    createdLocally: Boolean(row.created_locally ?? row.createdLocally ?? false),
    syncStatus: (row.sync_status ?? row.syncStatus ?? 'PENDING') as UserSyncStatus,
    syncError: (row.sync_error ?? row.syncError ?? null) as string | null,
    failedLoginAttempts: (row.failed_login_attempts ?? row.failedLoginAttempts ?? 0) as number,
    lockedUntil: (row.locked_until ?? row.lockedUntil ?? null) as string | null,
    mustChangePassword: Boolean(row.must_change_password ?? row.mustChangePassword ?? false),
    createdAt: (row.created_at ?? row.createdAt) as string,
    updatedAt: (row.updated_at ?? row.updatedAt) as string,
    lastLoginAt: (row.last_login_at ?? row.lastLoginAt ?? null) as string | null,
    deletedAt: (row.deleted_at ?? row.deletedAt ?? null) as string | null,
  };
}

import type { UserSyncStatus, CredentialMode } from './local-types';

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------

const SQL_INSERT_USER = `
  INSERT INTO "User" (
    id, username, "displayName", role, status,
    "passwordHash", "passwordVersion",
    "credentialMode", "createdLocally", "syncStatus",
    "failedLoginAttempts", "mustChangePassword",
    "createdAt", "updatedAt"
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7,
    $8, $9, $10,
    $11, $12,
    $13, $14
  )
  ON CONFLICT (id) DO NOTHING;
`;

const SQL_UPSERT_IDENTITY = `
  INSERT INTO "User" (
    id, username, "displayName", role, status,
    "passwordHash", "passwordVersion",
    "credentialMode", "createdLocally", "syncStatus",
    "failedLoginAttempts", "mustChangePassword",
    "createdAt", "updatedAt"
  ) VALUES (
    $1, $2, $3, $4, 'ACTIVE',
    '', 1,
    'PASSWORD', false, 'SYNCED',
    0, false,
    $5, $5
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    "displayName" = EXCLUDED."displayName",
    role = EXCLUDED.role,
    "deletedAt" = NULL,
    "updatedAt" = EXCLUDED."updatedAt";
`;

const SQL_UPDATE_PASSWORD = `
  UPDATE "User" SET
    "passwordHash" = $1,
    "passwordVersion" = "passwordVersion" + 1,
    "updatedAt" = $2
  WHERE id = $3 AND "deletedAt" IS NULL;
`;

const SQL_UPDATE_STATUS = `
  UPDATE "User" SET
    status = $1,
    "updatedAt" = $2
  WHERE id = $3 AND "deletedAt" IS NULL;
`;

const SQL_RESET_ATTEMPTS = `
  UPDATE "User" SET
    "failedLoginAttempts" = 0,
    "lockedUntil" = NULL,
    "updatedAt" = $1
  WHERE id = $2 AND "deletedAt" IS NULL;
`;

const SQL_RECORD_LOGIN = `
  UPDATE "User" SET
    "lastLoginAt" = $1,
    "failedLoginAttempts" = 0,
    "lockedUntil" = NULL,
    "updatedAt" = $1
  WHERE id = $2 AND "deletedAt" IS NULL;
`;

const SQL_GET_USER_BY_ID = `
  SELECT * FROM "User"
  WHERE id = $1 AND "deletedAt" IS NULL;
`;

const SQL_GET_USER_BY_USERNAME = `
  SELECT * FROM "User"
  WHERE username = $1 AND "deletedAt" IS NULL;
`;

const SQL_GET_ALL_USERS = `
  SELECT * FROM "User"
  WHERE "deletedAt" IS NULL
  ORDER BY "displayName" ASC;
`;

const SQL_SOFT_DELETE = `
  UPDATE "User" SET
    "deletedAt" = $1,
    "updatedAt" = $1
  WHERE id = $2;
`;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createUserCacheService(): UserCacheService {
  return {
    createUser: async (params) => {
      const { client } = await getLocalDatabase();
      const now = new Date().toISOString();

      // Check uniqueness
      const existing = await client.query(SQL_GET_USER_BY_USERNAME, [params.username]);
      if (existing.rows.length > 0) {
        throw new UserAlreadyExistsException(params.username);
      }

      const passwordHash = await hashPassword(params.password);

      await client.query(SQL_INSERT_USER, [
        params.id,
        params.username,
        params.displayName,
        params.role,
        'ACTIVE',
        passwordHash,
        1, // passwordVersion
        'PASSWORD',
        params.createdLocally,
        'PENDING',
        0, // failedLoginAttempts
        false, // mustChangePassword
        now,
        now,
      ]);

      const result = await client.query(SQL_GET_USER_BY_ID, [params.id]);
      return rowToUserData(result.rows[0] as Record<string, unknown>);
    },

    getUser: async (userId) => {
      const { client } = await getLocalDatabase();
      const result = await client.query(SQL_GET_USER_BY_ID, [userId]);
      if (result.rows.length === 0) return null;
      return rowToUserData(result.rows[0] as Record<string, unknown>);
    },

    upsertUserIdentity: async (params) => {
      const { client } = await getLocalDatabase();
      const now = new Date().toISOString();
      await client.query(SQL_UPSERT_IDENTITY, [
        params.id,
        params.username,
        params.displayName,
        params.role,
        now,
      ]);
    },

    getUserByUsername: async (username) => {
      const { client } = await getLocalDatabase();
      const result = await client.query(SQL_GET_USER_BY_USERNAME, [username]);
      if (result.rows.length === 0) return null;
      return rowToUserData(result.rows[0] as Record<string, unknown>);
    },

    getUsers: async () => {
      const { client } = await getLocalDatabase();
      const result = await client.query(SQL_GET_ALL_USERS);
      return result.rows.map((r: unknown) => rowToUserData(r as Record<string, unknown>));
    },

    verifyPassword: async (userId, password) => {
      const { client } = await getLocalDatabase();
      const result = await client.query(SQL_GET_USER_BY_ID, [userId]);
      if (result.rows.length === 0) {
        throw new UserNotFoundException(userId);
      }

      const user = result.rows[0] as Record<string, unknown>;
      const lockedUntil = user.locked_until ?? user.lockedUntil ?? null;

      // Check disabled
      const status = (user.status as string) ?? (user.status as string);
      if (status === 'DISABLED') {
        throw new UserDisabledException();
      }

      // Check lock
      if (lockedUntil) {
        const lockTime = new Date(lockedUntil as string).getTime();
        if (lockTime > Date.now()) {
          return {
            valid: false,
            locked: true,
            remainingAttempts: 0,
          };
        }
        // Lock expired — reset
        await client.query(SQL_RESET_ATTEMPTS, [new Date().toISOString(), userId]);
      }

      const passwordHash = (user.passwordHash ?? user.passwordHash) as string;
      // Identity-only rows (created by `upsertUserIdentity` for name
      // resolution) carry an empty placeholder hash.  They must never
      // count attempts or lock — otherwise every login would increment
      // the counter and a legit user would get locked out every few
      // logins without ever being able to verify locally.
      if (passwordHash.split(':').length < 4) {
        return { valid: false, locked: false, remainingAttempts: MAX_ATTEMPTS };
      }

      const isValid = await verifyHash(password, passwordHash);

      if (isValid) {
        return { valid: true, locked: false, remainingAttempts: MAX_ATTEMPTS };
      }

      // Failed attempt
      const attempts = ((user.failedLoginAttempts ?? user.failed_login_attempts ?? 0) as number) + 1;

      if (attempts >= MAX_ATTEMPTS) {
        // Permanent lock — admin unlock required
        await client.query(
          `UPDATE "User" SET "failedLoginAttempts" = $1, "lockedUntil" = '9999-12-31T23:59:59Z', "updatedAt" = $2 WHERE id = $3`,
          [attempts, new Date().toISOString(), userId],
        );
        throw new UserMaxAttemptsException();
      }

      if (attempts >= LOCK_THRESHOLD_ATTEMPTS) {
        const lockUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
        await client.query(
          `UPDATE "User" SET "failedLoginAttempts" = $1, "lockedUntil" = $2, "updatedAt" = $3 WHERE id = $4`,
          [attempts, lockUntil, new Date().toISOString(), userId],
        );
      } else {
        await client.query(
          `UPDATE "User" SET "failedLoginAttempts" = $1, "updatedAt" = $2 WHERE id = $3`,
          [attempts, new Date().toISOString(), userId],
        );
      }

      return {
        valid: false,
        locked: false,
        remainingAttempts: MAX_ATTEMPTS - attempts,
      };
    },

    updatePassword: async (userId, newPassword) => {
      const { client } = await getLocalDatabase();
      const passwordHash = await hashPassword(newPassword);
      await client.query(SQL_UPDATE_PASSWORD, [passwordHash, new Date().toISOString(), userId]);
    },

    setStatus: async (userId, status) => {
      const { client } = await getLocalDatabase();
      await client.query(SQL_UPDATE_STATUS, [status, new Date().toISOString(), userId]);
    },

    unlockUser: async (userId) => {
      const { client } = await getLocalDatabase();
      await client.query(SQL_RESET_ATTEMPTS, [new Date().toISOString(), userId]);
    },

    recordLogin: async (userId) => {
      const { client } = await getLocalDatabase();
      await client.query(SQL_RECORD_LOGIN, [new Date().toISOString(), userId]);
    },

    deleteUser: async (userId) => {
      const { client } = await getLocalDatabase();
      await client.query(SQL_SOFT_DELETE, [new Date().toISOString(), userId]);
    },
  };
}
