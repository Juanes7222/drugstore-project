/**
 * Local auth service for the POS desktop app.
 *
 * The first login of a running app session requires connectivity: it calls
 * the server's POST /auth/login over HTTP exactly like any other client.
 * On success, the returned claims are held in the Zustand in-memory store
 * for the lifetime of the running process.
 *
 * If the connection drops afterward, the cached in-memory session keeps
 * working for every local operation until the app is closed. Closing and
 * reopening the app always requires a fresh login, which again requires
 * connectivity at that moment.
 */
import { RoleType } from '@pharmacy/shared-types';
import { useLocalSessionStore, LocalSession } from './local-session.store';
import { InvalidCredentialsException } from './exceptions';
import { NoActiveSessionException } from './exceptions';
import { InsufficientRoleException } from './exceptions';

/**
 * Thin wrapper over fetch for calling the server's login endpoint.
 *
 * Exported only to allow dependency injection in tests. The default export
 * uses the real fetch API.
 */
export interface LoginHttpClient {
  post<TReq, TRes>(url: string, body: TReq, headers: Record<string, string>): Promise<TRes>;
}

/**
 * Shape the server's POST /auth/login endpoint returns.
 */
interface ServerAuthResponse {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    role: string;
    username: string;
  };
}

/**
 * Default HTTP client using the global fetch API.
 */
const defaultHttpClient: LoginHttpClient = {
  post: async <TReq, TRes>(
    url: string,
    body: TReq,
    headers: Record<string, string>,
  ): Promise<TRes> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new InvalidCredentialsException();
    }

    return response.json() as Promise<TRes>;
  },
};

export interface AuthServiceConfig {
  /** The server base URL, e.g. "http://localhost:3000" */
  baseUrl: string;
  /**
   * Optional override of the HTTP client (for testing).
   * When omitted, the real fetch-based client is used.
   */
  httpClient?: LoginHttpClient;
}

export const createAuthService = (config: AuthServiceConfig): AuthService => {
  const http = config.httpClient ?? defaultHttpClient;

  return {
    /**
     * Authenticate against the server and cache the session in memory.
     *
     * Throws `InvalidCredentialsException` on failure.
     */
    login: async (
      username: string,
      password: string,
      workstationId: string,
    ): Promise<LocalSession> => {
      const response = await http.post<{ username: string; password: string }, ServerAuthResponse>(
        `${config.baseUrl.replace(/\/$/, '')}/auth/login`,
        { username, password },
        { 'x-workstation-id': workstationId },
      );

      const session: LocalSession = {
        userId: response.user.id,
        username: response.user.username,
        fullName: `${response.user.firstName} ${response.user.lastName}`.trim(),
        role: response.user.role,
        workstationId,
      };

      useLocalSessionStore.getState().setSession(session);
      return session;
    },

    /**
     * Return the currently cached session or throw.
     */
    getCurrentSession: (): LocalSession | null => {
      const session = useLocalSessionStore.getState().session;
      return session;
    },

    /**
     * Require the current session's role to be among the allowed values.
     *
     * Throws `NoActiveSessionException` if there is no session, and
     * `InsufficientRoleException` if the role is not in the allowed set.
     *
     * This is the local equivalent of NestJS's `@Roles()` guard, called
     * explicitly at the top of any service method that needs it, since
     * there is no HTTP middleware layer in this app.
     */
    requireRole: (...allowedRoles: RoleType[]): LocalSession => {
      const session = useLocalSessionStore.getState().session;
      if (!session) {
        throw new NoActiveSessionException();
      }

      const sessionRole = session.role as RoleType;
      if (!allowedRoles.includes(sessionRole)) {
        throw new InsufficientRoleException(allowedRoles.join(' or '));
      }

      return session;
    },

    /**
     * Clear the in-memory session (logout).
     */
    logout: (): void => {
      useLocalSessionStore.getState().clearSession();
    },
  };
};

export interface AuthService {
  login(username: string, password: string, workstationId: string): Promise<LocalSession>;
  getCurrentSession(): LocalSession | null;
  requireRole(...allowedRoles: RoleType[]): LocalSession;
  logout(): void;
}