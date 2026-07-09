/**
 * Thin HTTP client for the POS renderer.
 *
 * Uses the native `fetch` API, attaches the bearer token from the provided
 * AuthTokenProvider, and rejects with a typed HttpError on non-2xx status
 * codes so callers can decide how to degrade.
 */
import { AuthTokenProvider } from "./auth-token-provider";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseText: string,
    message: string,
  ) {
    super(message);
  }
}

export interface HttpClient {
  get<T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T>;
}

const buildQueryString = (
  params: Record<string, string | number | boolean | undefined>,
): string => {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      searchParams.set(key, String(value));
    }
  });

  const query = searchParams.toString();
  return query ? `?${query}` : "";
};

export const createHttpClient = (
  baseUrl: string,
  authTokenProvider?: AuthTokenProvider,
): HttpClient => ({
  get: async <T>(
    path: string,
    params?: Record<string, string | number | boolean | undefined>,
  ): Promise<T> => {
    const query = params ? buildQueryString(params) : "";
    const url = `${baseUrl.replace(/\/$/, "")}${path}${query}`;

    const token = await authTokenProvider?.getAccessToken();

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;

    try {
      response = await fetch(url, { method: "GET", headers });
    } catch (networkError) {
      // fetch throws on network failure (offline, DNS, refused, etc.)
      throw new HttpError(
        0,
        "",
        networkError instanceof Error
          ? networkError.message
          : "Network request failed",
      );
    }

    if (!response.ok) {
      const responseText = await response.text();
      throw new HttpError(
        response.status,
        responseText,
        `HTTP ${response.status}: ${response.statusText}`,
      );
    }

    return response.json() as Promise<T>;
  },
});
