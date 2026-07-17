/**
 * HTTP client for the auth service.
 *
 * Exported separately so tests can inject a mock.
 */

export interface AuthHttpClient {
  post<TRes>(path: string, body: unknown): Promise<TRes>;
  postWithAuth<TRes>(path: string, body: unknown, accessToken: string): Promise<TRes>;
  getWithAuth<TRes>(path: string, accessToken: string): Promise<TRes>;
}

export function createAuthHttpClient(baseUrl: string): AuthHttpClient {
  const apiBase = baseUrl.replace(/\/$/, '');

  return {
    post: async <TRes>(path: string, body: unknown): Promise<TRes> => {
      const response = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

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
  };
}

import { InvalidCredentialsException } from './exceptions';
