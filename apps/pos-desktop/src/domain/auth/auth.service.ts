/**
 * Local auth service for the POS desktop app.
 *
 * Supports multi-factor login flow (PASSWORD/PIN → TOTP if enabled),
 * refresh token rotation, automatic session refresh, and step-up
 * authorization.
 *
 * The first login of a running app session requires connectivity: it calls
 * the server's POST /auth/login over HTTP exactly like any other client.
 * On success, the returned claims are held in the Zustand in-memory store
 * for the lifetime of the running process.
 */
import { RoleType } from '@pharmacy/shared-types';
import { useLocalSessionStore, LocalSession } from './local-session.store';
import { InvalidCredentialsException, NoActiveSessionException, InsufficientRoleException } from './exceptions';
import { createAuthHttpClient, AuthHttpClient } from './auth-http-client';
import { createSecureStorage } from '../../infrastructure/secure-storage';
import { createOfflineAuthService } from '../../renderer/services/auth/offline/offline-auth-service';

/**
 * Shape the server's POST /auth/login endpoint returns.
 */
interface ServerAuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  sessionId: string;
  requiresTwoFactor?: boolean;
  challengeToken?: string;
  evictedSessionId?: string;
  user: {
    id: string;
    role: string;
    email: string | null;
    username: string;
    displayName: string;
    subscriptionId: string | null;
    totpEnabled: boolean;
    avatarUrl: string | null;
    avatarColor: string | null;
    mustChangePassword: boolean;
  };
  /** Offline JWT token for offline-first authentication, returned when the server supports it. */
  offlineToken?: { token: string; expiresAt: string };
  /** Encrypted credential verification key for offline PIN/password validation. */
  credentialVerificationKey?: { encryptedBlob: string; keyFingerprint: string; version: number };
}

interface ServerRefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

export interface AuthServiceConfig {
  /** The server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
  /** Optional override of the HTTP client (for testing). */
  httpClient?: AuthHttpClient;
}

export const createAuthService = (config: AuthServiceConfig): AuthService => {
  const http = config.httpClient ?? createAuthHttpClient(config.baseUrl);

  return {
    /**
     * Authenticate against the server with password or PIN.
     * If the user has 2FA enabled, returns a challenge token for the second step.
     */
    login: async (
      identifier: string,
      secret: string,
      sessionType: 'PASSWORD' | 'PIN',
      workstationId: string,
      hardwareFingerprint?: string,
      deviceInfo?: string,
    ): Promise<{ session?: LocalSession; requiresTwoFactor?: boolean; challengeToken?: string }> => {
      const response = await http.post<ServerAuthResponse>('/auth/login', {
        identifier,
        secret,
        sessionType,
        workstationId,
        hardwareFingerprint,
        deviceInfo,
      });

      if (response.requiresTwoFactor && response.challengeToken) {
        return {
          requiresTwoFactor: true,
          challengeToken: response.challengeToken,
        };
      }

      const session = mapServerResponseToSession(
        response,
        workstationId,
        identifier,
      );
      useLocalSessionStore.getState().setSession(session);

      // Cache the authenticated user's profile for the login avatar grid
      // and QuickSwitch offline fallback. Non-fatal.
      import('./local-user-cache')
        .then(({ cacheUser }) => cacheUser({
          id: response.user.id,
          displayName: response.user.displayName,
          role: response.user.role as RoleType,
          avatarUrl: response.user.avatarUrl ?? null,
          avatarColor: response.user.avatarColor ?? null,
          username: response.user.username,
        }))
        .catch(() => { /* non-fatal */ });

      // Cache offline credentials for future offline-first logins.
      // Non-fatal: failure does not block login.
      if (response.offlineToken || response.credentialVerificationKey) {
        cacheOfflineCredentials(config.baseUrl, response, workstationId).catch((err) => {
          console.warn('Failed to cache offline credentials:', err);
        });
      }

      return { session };
    },

    /**
     * Complete two-factor authentication.
     */
    completeTwoFactor: async (
      challengeToken: string,
      totpCode?: string,
      backupCode?: string,
    ): Promise<LocalSession> => {
      const response = await http.post<ServerAuthResponse>('/auth/login/2fa', {
        challengeToken,
        totpCode,
        backupCode,
      });

      const session = mapServerResponseToSession(
        response,
        '',
        '',
      );
      useLocalSessionStore.getState().setSession(session);

      // Cache the authenticated user's profile. Non-fatal.
      import('./local-user-cache')
        .then(({ cacheUser }) => cacheUser({
          id: response.user.id,
          displayName: response.user.displayName,
          role: response.user.role as RoleType,
          avatarUrl: response.user.avatarUrl ?? null,
          avatarColor: response.user.avatarColor ?? null,
          username: response.user.username,
        }))
        .catch(() => { /* non-fatal */ });

      // Cache offline credentials for future offline-first logins.
      // Non-fatal: failure does not block login.
      if (response.offlineToken || response.credentialVerificationKey) {
        cacheOfflineCredentials(config.baseUrl, response, '').catch((err) => {
          console.warn('Failed to cache offline credentials after 2FA:', err);
        });
      }

      return session;
    },

    /**
     * Refresh the current session by exchanging the refresh token.
     */
    refreshSession: async (): Promise<LocalSession | null> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession?.refreshToken) {
        return null;
      }

      try {
        const response = await http.postWithAuth<ServerRefreshResponse>(
          '/auth/refresh',
          {},
          currentSession.accessToken,
        );

        const updatedSession: LocalSession = {
          ...currentSession,
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          expiresAt: new Date(response.expiresAt),
        };

        useLocalSessionStore.getState().updateSession({
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          expiresAt: new Date(response.expiresAt),
        });

        return updatedSession;
      } catch {
        useLocalSessionStore.getState().clearSession();
        return null;
      }
    },

    /**
     * Request a step-up authorization.
     */
    requestStepUp: async (params: {
      operationType: string;
      operationId?: string;
      workstationId: string;
      requiredRole: RoleType;
      method?: 'PIN' | 'REMOTE' | 'CODE';
    }): Promise<any> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();

      return http.postWithAuth('/auth/step-up/request', params, currentSession.accessToken);
    },

    /**
     * Approve a step-up request (manager action).
     */
    approveStepUp: async (requestId: string, method: 'PIN' | 'REMOTE' | 'CODE'): Promise<{ approvalToken: string }> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();

      return http.postWithAuth('/auth/step-up/approve', { requestId, method }, currentSession.accessToken);
    },

    /**
     * Verify a step-up approval token.
     */
    verifyStepUp: async (approvalToken: string, operationType?: string): Promise<boolean> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();

      const result = await http.postWithAuth<{ valid: boolean }>(
        '/auth/step-up/verify',
        { approvalToken, operationType },
        currentSession.accessToken,
      );
      return result.valid;
    },

    /**
     * Change the current user's password.
     */
    changePassword: async (currentPassword: string, newPassword: string): Promise<void> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();

      await http.postWithAuth('/auth/change-password', { currentPassword, newPassword }, currentSession.accessToken);
    },

    /**
     * Change the current user's PIN.
     */
    changePin: async (currentPin: string, newPin: string): Promise<void> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();

      await http.postWithAuth('/auth/change-pin', { currentPin, newPin }, currentSession.accessToken);
    },

    /**
     * Forgot password — request a reset link.
     */
    forgotPassword: async (email: string): Promise<{ message: string }> => {
      return http.post('/auth/forgot-password', { email });
    },

    /**
     * Complete password reset with token.
     */
    resetPassword: async (token: string, newPassword: string): Promise<void> => {
      await http.post('/auth/reset-password', { token, newPassword });
    },

    /**
     * Return the currently cached session or null.
     */
    getCurrentSession: (): LocalSession | null => {
      return useLocalSessionStore.getState().session;
    },

    /**
     * Require the current session's role to be among the allowed values.
     */
    requireRole: (...allowedRoles: RoleType[]): LocalSession => {
      const session = useLocalSessionStore.getState().session;
      if (!session) {
        throw new NoActiveSessionException();
      }

      const sessionRole = session.role as RoleType;

      // Direct match
      if (allowedRoles.includes(sessionRole)) {
        return session;
      }

      // Role supersession: higher-level roles implicitly satisfy lower checks.
      // Matches the server's roles.guard.ts logic.
      const ROLE_SUPERSEDES: Partial<Record<RoleType, RoleType[]>> = {
        [RoleType.OWNER]: [RoleType.ADMIN, RoleType.MANAGER, RoleType.ACCOUNTANT, RoleType.INVENTORY_ASSISTANT],
        [RoleType.SAAS_ADMIN]: [
          RoleType.OWNER, RoleType.ADMIN, RoleType.MANAGER,
          RoleType.ACCOUNTANT, RoleType.CASHIER, RoleType.INVENTORY_ASSISTANT,
        ],
      };

      const hasRole = allowedRoles.some((required) =>
        ROLE_SUPERSEDES[sessionRole]?.includes(required) ?? false,
      );

      if (!hasRole) {
        throw new InsufficientRoleException(allowedRoles.join(' or '));
      }

      return session;
    },

    /**
     * Clear the in-memory session and notify the server.
     */
    logout: async (): Promise<void> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (currentSession?.accessToken) {
        try {
          await http.postWithAuth('/auth/logout', {}, currentSession.accessToken);
        } catch {
          // Server logout is best-effort
        }
      }
      useLocalSessionStore.getState().clearSession();
    },

    /**
     * Create a new user (manager/owner only).
     */
    createUser: async (params: {
      displayName: string;
      username?: string;
      email?: string;
      role: 'MANAGER' | 'CASHIER';
      initialPin?: string;
      initialPassword?: string;
      locationIds?: string[];
    }): Promise<any> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();
      return http.postWithAuth('/users', params, currentSession.accessToken);
    },

    /**
     * List users (OWNER/MANAGER only — server enforces this via RolesGuard).
     */
    listUsers: async (filters?: {
      role?: string;
      status?: string;
      locationId?: string;
      limit?: number;
      offset?: number;
    }): Promise<{ users: any[]; total: number }> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();

      const params = new URLSearchParams();
      if (filters?.role) params.set('role', filters.role);
      if (filters?.status) params.set('status', filters.status);
      if (filters?.locationId) params.set('locationId', filters.locationId);
      if (filters?.limit) params.set('limit', String(filters.limit));
      if (filters?.offset) params.set('offset', String(filters.offset));

      return http.getWithAuth(`/users?${params.toString()}`, currentSession.accessToken);
    },

    /**
     * Disable a user (OWNER/MANAGER only).
     */
    disableUser: async (userId: string): Promise<{ message: string }> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();
      return http.postWithAuth<{ message: string }>(
        `/users/${userId}/disable`,
        {},
        currentSession.accessToken,
      );
    },

    /**
     * Enable a disabled user (OWNER/MANAGER only).
     */
    enableUser: async (userId: string): Promise<{ message: string }> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();
      return http.postWithAuth<{ message: string }>(
        `/users/${userId}/enable`,
        {},
        currentSession.accessToken,
      );
    },

    /**
     * Unlock a locked user account (OWNER/MANAGER only).
     */
    unlockUser: async (userId: string): Promise<{ message: string }> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();
      return http.postWithAuth<{ message: string }>(
        `/users/${userId}/unlock`,
        {},
        currentSession.accessToken,
      );
    },

    /**
     * Reset a user's PIN (OWNER/MANAGER only). Returns the new PIN.
     */
    resetUserPin: async (userId: string): Promise<{ newPin: string; message: string }> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();
      return http.postWithAuth<{ newPin: string; message: string }>(
        `/users/${userId}/reset-pin`,
        {},
        currentSession.accessToken,
      );
    },

    /**
     * Get pending step-up requests for the current manager.
     */
    getPendingStepUpRequests: async (): Promise<any[]> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();
      return http.getWithAuth('/auth/step-up/pending', currentSession.accessToken);
    },

    /**
     * Get audit logs.
     */
    getAuditLogs: async (filters?: {
      event?: string;
      actorId?: string;
      fromDate?: string;
      toDate?: string;
      limit?: number;
      offset?: number;
    }): Promise<any> => {
      const currentSession = useLocalSessionStore.getState().session;
      if (!currentSession) throw new NoActiveSessionException();

      const params = new URLSearchParams();
      if (filters?.event) params.set('event', filters.event);
      if (filters?.actorId) params.set('actorId', filters.actorId);
      if (filters?.fromDate) params.set('fromDate', filters.fromDate);
      if (filters?.toDate) params.set('toDate', filters.toDate);
      if (filters?.limit) params.set('limit', String(filters.limit));
      if (filters?.offset) params.set('offset', String(filters.offset));

      return http.getWithAuth(`/audit?${params.toString()}`, currentSession.accessToken);
    },
  };
};

export interface AuthService {
  login(
    identifier: string,
    secret: string,
    sessionType: 'PASSWORD' | 'PIN',
    workstationId: string,
    hardwareFingerprint?: string,
    deviceInfo?: string,
  ): Promise<{ session?: LocalSession; requiresTwoFactor?: boolean; challengeToken?: string }>;

  completeTwoFactor(
    challengeToken: string,
    totpCode?: string,
    backupCode?: string,
  ): Promise<LocalSession>;

  refreshSession(): Promise<LocalSession | null>;

  requestStepUp(params: {
    operationType: string;
    operationId?: string;
    workstationId: string;
    requiredRole: RoleType;
    method?: 'PIN' | 'REMOTE' | 'CODE';
  }): Promise<any>;

  approveStepUp(requestId: string, method: 'PIN' | 'REMOTE' | 'CODE'): Promise<{ approvalToken: string }>;

  verifyStepUp(approvalToken: string, operationType?: string): Promise<boolean>;

  changePassword(currentPassword: string, newPassword: string): Promise<void>;

  changePin(currentPin: string, newPin: string): Promise<void>;

  forgotPassword(email: string): Promise<{ message: string }>;

  resetPassword(token: string, newPassword: string): Promise<void>;

  getCurrentSession(): LocalSession | null;

  requireRole(...allowedRoles: RoleType[]): LocalSession;

  logout(): Promise<void>;

  createUser(params: {
    displayName: string;
    username?: string;
    email?: string;
    role: 'MANAGER' | 'CASHIER';
    initialPin?: string;
    initialPassword?: string;
    locationIds?: string[];
  }): Promise<any>;

  listUsers(filters?: {
    role?: string;
    status?: string;
    locationId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ users: any[]; total: number }>;

  disableUser(userId: string): Promise<{ message: string }>;

  enableUser(userId: string): Promise<{ message: string }>;

  unlockUser(userId: string): Promise<{ message: string }>;

  resetUserPin(userId: string): Promise<{ newPin: string; message: string }>;

  getPendingStepUpRequests(): Promise<any[]>;

  getAuditLogs(filters?: {
    event?: string;
    actorId?: string;
    fromDate?: string;
    toDate?: string;
    limit?: number;
    offset?: number;
  }): Promise<any>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapServerResponseToSession(
  response: ServerAuthResponse,
  workstationId: string,
  identifier: string,
): LocalSession {
  return {
    userId: response.user.id,
    username: response.user.username || identifier,
    fullName: response.user.displayName,
    displayName: response.user.displayName,
    email: response.user.email,
    role: response.user.role,
    subscriptionId: response.user.subscriptionId,
    workstationId,
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    expiresAt: new Date(response.expiresAt),
    sessionId: response.sessionId || '',
    totpEnabled: response.user.totpEnabled,
    avatarUrl: response.user.avatarUrl,
    avatarColor: response.user.avatarColor,
    mustChangePassword: response.user.mustChangePassword,
  };
}

/**
 * Attempt to cache offline credentials after a successful online login.
 *
 * This is a best-effort operation — failure is intentionally swallowed
 * because offline caching is non-critical for the primary login flow.
 */
async function cacheOfflineCredentials(
  baseUrl: string,
  response: Pick<ServerAuthResponse, 'offlineToken' | 'credentialVerificationKey'>,
  workstationId: string,
): Promise<void> {
  const secureStorage = await createSecureStorage();
  const offlineService = createOfflineAuthService({ baseUrl, secureStorage });
  await offlineService.updateCachedCredentials(response, workstationId);
}
