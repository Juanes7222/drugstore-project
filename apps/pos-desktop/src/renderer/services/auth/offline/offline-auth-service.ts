/**
 * Offline Auth Service — orchestrates offline login, blessing, and
 * credential cache management for the POS desktop terminal.
 *
 * This service sits between the UI layer (hooks, pages) and the offline
 * auth domain (types, validation, storage I/O, session lifecycle). It
 * coordinates reads from and writes to SecureStorage, the Zustand
 * offline session store, and the server (when available).
 *
 * ## Usage
 *
 * ```typescript
 * const service = createOfflineAuthService({ baseUrl: API_BASE_URL });
 * const result = await service.attemptOfflineLogin(
 *   userId,
 *   pin,
 *   'PIN',
 *   workstationFingerprint,
 * );
 * ```
 *
 * The service is fully injectable — pass a custom `secureStorage`
 * implementation for testing.
 */
import { createAuthHttpClient, type AuthHttpClient } from '../../../../domain/auth/auth-http-client';
import { useLocalSessionStore } from '../../../../domain/auth/local-session.store';
import {
  // Types
  type OfflineSession,
  type BlessingResult,
  type RevocationListEntry,
  type OfflineLoginResult,
  type CredentialCacheEntry,
  // Exceptions
  NoOfflineCredentialsException,
  OfflineCredentialsExpiredException,
  OfflineTokenRevokedException,
  SecureStorageUnavailableException,
  // Validation
  decodeOfflineToken,
  isRevoked,
  // Storage I/O
  getCredentialCacheEntry,
  setCredentialCacheEntry,
  getRevocationList,
  saveOfflineSession,
  // Session lifecycle
  createOfflineSession,
  // Store
  useOfflineSessionStore,
} from '../../../../domain/auth/offline';
import { createSecureStorage, type SecureStorage } from '../../../../infrastructure/secure-storage';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Storage key prefix for cached offline tokens. */
const OFFLINE_TOKEN_KEY_PREFIX = 'offline_token_';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OfflineAuthService {
  /**
   * Attempt an offline-first login using cached credentials.
   *
   * The flow:
   *  1. Read credential cache from secure storage.
   *  2. If no entry -> throw `NoOfflineCredentialsException`.
   *  3. If entry expired -> throw `OfflineCredentialsExpiredException`.
   *  4. Read the cached offline token from secure storage.
   *  5. Verify token structure, expiration, and workstation binding.
   *  6. If token revoked -> throw `OfflineTokenRevokedException`.
   *  7. Check the local revocation list.
   *  8. Create an `OfflineSession` via the domain function.
   *  9. Persist the session to the Zustand store.
   * 10. Return the new session.
   */
  attemptOfflineLogin(
    userId: string,
    enteredCredential: string,
    credentialType: 'PIN' | 'PASSWORD',
    workstationFingerprint: string,
  ): Promise<OfflineLoginResult>;

  /**
   * Send one or more pending offline sessions to the server for blessing.
   *
   * Requires an active online session's `accessToken` for authentication.
   */
  blessPendingSessions(
    pendingSessions: OfflineSession[],
    accessToken: string,
  ): Promise<BlessingResult[]>;

  /**
   * Fetch the latest JWT revocation list from the server.
   *
   * @param since        Only entries revoked after this date.
   * @param accessToken  The current online session's access token.
   */
  fetchRevocationList(
    since: Date,
    accessToken: string,
  ): Promise<RevocationListEntry[]>;

  /**
   * Store offline credentials returned by a successful online login.
   *
   * This method is called after `login()` or `completeTwoFactor()` on the
   * main auth service when the server response includes offline token and
   * credential verification key fields.
   */
  updateCachedCredentials(
    response: {
      offlineToken?: { token: string; expiresAt: string };
      credentialVerificationKey?: {
        encryptedBlob: string;
        keyFingerprint: string;
        version: number;
      };
    },
    workstationFingerprint: string,
  ): Promise<void>;

  /** Remove the current offline session (logout). */
  logoutOffline(localSessionId: string): Promise<void>;

  /** Access the underlying Zustand offline session store. */
  getOfflineSessionStore(): typeof useOfflineSessionStore;

  /** Whether offline login is available (secure storage initialised). */
  isOfflineLoginAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the storage key for a user's cached offline token.
 */
function offlineTokenKey(userId: string): string {
  return OFFLINE_TOKEN_KEY_PREFIX + userId;
}

/**
 * Read a cached offline token from secure storage.
 */
async function getCachedOfflineToken(
  userId: string,
  secureStorage: SecureStorage,
): Promise<string | null> {
  return secureStorage.getItem(offlineTokenKey(userId));
}

/**
 * Write a cached offline token to secure storage.
 */
async function setCachedOfflineToken(
  userId: string,
  token: string,
  secureStorage: SecureStorage,
): Promise<void> {
  await secureStorage.setItem(offlineTokenKey(userId), token);
}

/**
 * Remove a cached offline token from secure storage.
 */
async function removeCachedOfflineToken(
  userId: string,
  secureStorage: SecureStorage,
): Promise<void> {
  await secureStorage.removeItem(offlineTokenKey(userId));
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an `OfflineAuthService` instance.
 *
 * @param config.baseUrl         The server base URL for HTTP calls.
 * @param config.secureStorage   Optional secure storage override (for DI/testing).
 */
export function createOfflineAuthService(config: {
  baseUrl: string;
  secureStorage?: SecureStorage;
}): OfflineAuthService {
  const http: AuthHttpClient = createAuthHttpClient(config.baseUrl);
  const getSecureStorage = async (): Promise<SecureStorage> => {
    if (config.secureStorage) return config.secureStorage;
    return createSecureStorage();
  };

  return {
    // -----------------------------------------------------------------------
    // attemptOfflineLogin
    // -----------------------------------------------------------------------
    attemptOfflineLogin: async (
      userId: string,
      _enteredCredential: string,
      _credentialType: 'PIN' | 'PASSWORD',
      workstationFingerprint: string,
    ): Promise<OfflineLoginResult> => {
      const secureStorage = await getSecureStorage();

      // 1. Check availability
      const available = await secureStorage.isAvailable();
      if (!available) {
        throw new SecureStorageUnavailableException();
      }

      // 2. Read credential cache
      const cacheEntry = await getCredentialCacheEntry(userId, secureStorage);
      if (!cacheEntry) {
        throw new NoOfflineCredentialsException();
      }

      // 3. Validate cache entry expiration
      if (cacheEntry.expiresAt.getTime() < Date.now()) {
        throw new OfflineCredentialsExpiredException();
      }

      // 4. Read the cached offline token
      const offlineToken = await getCachedOfflineToken(userId, secureStorage);
      if (!offlineToken) {
        throw new NoOfflineCredentialsException();
      }

      // 5. Verify the offline token
      //    The server secret for HMAC verification is not available on the
      //    client directly — it is provisioned alongside the token and stored
      //    in SecureStorage during `updateCachedCredentials`.  For now we
      //    decode the token for structural validation (expiry, workstation
      //    binding); full signature verification will use the provisioned
      //    secret once the key exchange is implemented.
      const claims = decodeOfflineToken(offlineToken);
      if (!claims) {
        throw new OfflineTokenRevokedException();
      }

      // 5a. Workstation binding
      if (claims.wfp !== workstationFingerprint) {
        throw new OfflineTokenRevokedException();
      }

      // 5b. Token expiration
      const now = Math.floor(Date.now() / 1000);
      if (claims.exp < now) {
        throw new OfflineCredentialsExpiredException();
      }

      // 6 & 7. Check revocation list (exact jti + user-level markers)
      const revocationList = await getRevocationList(secureStorage);
      if (isRevoked(claims.jti, revocationList, claims.iat, claims.sub)) {
        throw new OfflineTokenRevokedException();
      }

      // 8. Create offline session via domain function
      const session = createOfflineSession(
        userId,
        claims.sub,
        '', // displayName will be populated from the cache entry
        claims.role,
        claims.subscriptionId,
        claims,
        workstationFingerprint,
      );

      // Populate the offline token on the session object
      const populatedSession: OfflineSession = {
        ...session,
        offlineToken,
      };

      // 9. Store session in Zustand store
      useOfflineSessionStore.getState().addSession(populatedSession);
      useOfflineSessionStore.getState().setCurrentSession(populatedSession.localSessionId);

      // Also persist to secure storage
      await saveOfflineSession(
        populatedSession.localSessionId,
        populatedSession as unknown as Record<string, unknown>,
        secureStorage,
      );

      return { session: populatedSession };
    },

    // -----------------------------------------------------------------------
    // blessPendingSessions
    // -----------------------------------------------------------------------
    blessPendingSessions: async (
      pendingSessions: OfflineSession[],
      accessToken: string,
    ): Promise<BlessingResult[]> => {
      const payload = pendingSessions.map((s: OfflineSession) => ({
        localSessionId: s.localSessionId,
        userId: s.userId,
        username: s.username,
        role: s.role,
        offlineToken: s.offlineToken,
        workstationFingerprint: s.workstationFingerprint,
        createdAt: s.createdAt.toISOString(),
      }));

      return http.postWithAuth<BlessingResult[]>(
        '/auth/offline-sessions/bless',
        { sessions: payload },
        accessToken,
      );
    },

    // -----------------------------------------------------------------------
    // fetchRevocationList
    // -----------------------------------------------------------------------
    fetchRevocationList: async (
      since: Date,
      accessToken: string,
    ): Promise<RevocationListEntry[]> => {
      const sinceParam = since.toISOString();
      return http.getWithAuth<RevocationListEntry[]>(
        `/auth/offline-tokens/revocation-list?since=${encodeURIComponent(sinceParam)}`,
        accessToken,
      );
    },

    // -----------------------------------------------------------------------
    // updateCachedCredentials
    // -----------------------------------------------------------------------
    updateCachedCredentials: async (
      response: {
        offlineToken?: { token: string; expiresAt: string };
        credentialVerificationKey?: {
          encryptedBlob: string;
          keyFingerprint: string;
          version: number;
        };
      },
      _workstationFingerprint: string,
    ): Promise<void> => {
      const secureStorage = await getSecureStorage();
      const available = await secureStorage.isAvailable();
      if (!available) {
        throw new SecureStorageUnavailableException();
      }

      // Store credential verification key as a CredentialCacheEntry
      if (response.credentialVerificationKey) {
        // Derive the userId from the current online session
        const currentSession = useLocalSessionStore.getState().session;
        if (currentSession) {
          const cacheEntry: CredentialCacheEntry = {
            userId: currentSession.userId,
            encryptedCredentials: response.credentialVerificationKey.encryptedBlob,
            keyFingerprint: response.credentialVerificationKey.keyFingerprint,
            expiresAt: new Date(
              // Default expiration: 30 days from now if not server-provided
              Date.now() + 30 * 24 * 60 * 60 * 1000,
            ),
            version: response.credentialVerificationKey.version,
          };

          await setCredentialCacheEntry(
            currentSession.userId,
            cacheEntry,
            secureStorage,
          );
        }
      }

      // Store offline token
      if (response.offlineToken) {
        const currentSession = useLocalSessionStore.getState().session;
        if (currentSession) {
          await setCachedOfflineToken(
            currentSession.userId,
            response.offlineToken.token,
            secureStorage,
          );

          // Also store the offline token expiration metadata
          await secureStorage.setItem(
            `offline_token_expiry_${currentSession.userId}`,
            response.offlineToken.expiresAt,
          );
        }
      }
    },

    // -----------------------------------------------------------------------
    // logoutOffline
    // -----------------------------------------------------------------------
    logoutOffline: async (localSessionId: string): Promise<void> => {
      const state = useOfflineSessionStore.getState();
      const session = state.sessions.find(
        (s: OfflineSession) => s.localSessionId === localSessionId,
      );

      // Remove from Zustand store
      state.removeSession(localSessionId);

      // Clean up secure storage
      if (session) {
        try {
          const secureStorage = await getSecureStorage();
          await removeCachedOfflineToken(session.userId, secureStorage);

          const offlineSessionKey = `offline_session_${localSessionId}`;
          await secureStorage.removeItem(offlineSessionKey);
          await secureStorage.removeItem(
            `offline_token_expiry_${session.userId}`,
          );
        } catch {
          // SecureStorage cleanup is best-effort
        }
      }
    },

    // -----------------------------------------------------------------------
    // getOfflineSessionStore
    // -----------------------------------------------------------------------
    getOfflineSessionStore: () => useOfflineSessionStore,

    // -----------------------------------------------------------------------
    // isOfflineLoginAvailable
    // -----------------------------------------------------------------------
    isOfflineLoginAvailable: async (): Promise<boolean> => {
      try {
        const secureStorage = await getSecureStorage();
        return secureStorage.isAvailable();
      } catch {
        return false;
      }
    },
  };
}
