/**
 * HTTP client for the auth service.
 *
 * Exported separately so tests can inject a mock.
 */

export interface AuthHttpClient {
  post<TRes>(path: string, body: unknown): Promise<TRes>;
  postWithAuth<TRes>(path: string, body: unknown, accessToken: string): Promise<TRes>;
  getWithAuth<TRes>(path: string, accessToken: string): Promise<TRes>;
  patchWithAuth<TRes>(path: string, body: unknown, accessToken: string): Promise<TRes>;
  deleteWithAuth<TRes>(path: string, accessToken: string): Promise<TRes>;
  /**
   * Like `post`, but rejects with `HttpStatusException` carrying the numeric
   * status so callers can branch on specific codes (e.g. 503/400/409).
   * Optional so existing minimal mocks remain valid.
   */
  postWithStatus?<TRes>(path: string, body: unknown): Promise<TRes>;
}

/**
 * Rejected by `postWithStatus` when the server responds with a non-2xx
 * status. Carries the numeric status and parsed (best-effort) body so the
 * caller can map it to a domain exception.
 */
export class HttpStatusException extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
  ) {
    super(`HTTP ${status}`);
    this.name = 'HttpStatusException';
  }
}

export function createAuthHttpClient(baseUrl: string): AuthHttpClient {
  const apiBase = baseUrl.replace(/\/$/, '');

  return {
    postWithStatus: async <TRes>(path: string, body: unknown): Promise<TRes> => {
      let response: Response;
      try {
        response = await fetch(`${apiBase}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        throw new NetworkErrorException(
          err instanceof Error ? err.message : undefined,
        );
      }

      if (!response.ok) {
        let parsed: unknown = null;
        try {
          parsed = await response.json();
        } catch {
          // Non-JSON error body — keep null.
        }
        throw new HttpStatusException(response.status, parsed);
      }

      return response.json() as Promise<TRes>;
    },

    post: async <TRes>(path: string, body: unknown): Promise<TRes> => {
      let response: Response;
      try {
        response = await fetch(`${apiBase}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (err) {
        // fetch threw because the server is unreachable (connection refused,
        // DNS failure, timeout).  Throw a typed error so the UI can fall
        // back to offline credentials.
        throw new NetworkErrorException(
          err instanceof Error ? err.message : undefined,
        );
      }

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw error.message
          ? new InvalidCredentialsException()
          : new InvalidCredentialsException();
      }

      return response.json() as Promise<TRes>;
    },

    postWithAuth: async <TRes>(
      path: string,
      body: unknown,
      accessToken: string,
    ): Promise<TRes> => {
      const response = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const serverMessage = (errorBody as any).message;
        throw new Error(
          serverMessage
            ? `[${response.status}] ${serverMessage}`
            : `[${response.status}] ${response.statusText}`,
        );
      }

      return response.json() as Promise<TRes>;
    },

    getWithAuth: async <TRes>(
      path: string,
      accessToken: string,
    ): Promise<TRes> => {
      const response = await fetch(`${apiBase}${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const serverMessage = (errorBody as any).message;
        throw new Error(
          serverMessage
            ? `[${response.status}] ${serverMessage}`
            : `[${response.status}] ${response.statusText}`,
        );
      }

      return response.json() as Promise<TRes>;
    },

    patchWithAuth: async <TRes>(
      path: string,
      body: unknown,
      accessToken: string,
    ): Promise<TRes> => {
      const response = await fetch(`${apiBase}${path}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const serverMessage = (errorBody as any).message;
        throw new Error(
          serverMessage
            ? `[${response.status}] ${serverMessage}`
            : `[${response.status}] ${response.statusText}`,
        );
      }

      return response.json() as Promise<TRes>;
    },

    deleteWithAuth: async <TRes>(
      path: string,
      accessToken: string,
    ): Promise<TRes> => {
      const response = await fetch(`${apiBase}${path}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        const serverMessage = (errorBody as any).message;
        throw new Error(
          serverMessage
            ? `[${response.status}] ${serverMessage}`
            : `[${response.status}] ${response.statusText}`,
        );
      }

      return response.json() as Promise<TRes>;
    },
  };
}

import { InvalidCredentialsException, NetworkErrorException } from './exceptions';
