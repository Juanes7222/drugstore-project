import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";
import { useAuthStore } from "../hooks/use-auth";

export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ?? "http://localhost:3000";

/**
 * Machine-readable code from the backend's HttpExceptionFilter payload
 * (`{ errorCode, message, statusCode, ... }`), or null when the failure was not
 * an HTTP error (network down, aborted request).
 *
 * Prefer this over the human-readable `message`: message text is English
 * server-side copy meant for logs, while errorCode is the stable contract.
 */
export function extractApiErrorCode(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  return (
    (error.response?.data as { errorCode?: string } | undefined)?.errorCode ?? null
  );
}

/** True when the throttler rejected the call (HTTP 429). */
export function isRateLimited(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 429;
}

export const api = axios.create({ baseURL: API_BASE_URL });

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) {
    throw new Error("No active session");
  }

  // The refresh endpoint requires a still-valid access token in the
  // Authorization header (JwtAuthGuard). The interceptor therefore fires
  // before expiry in most cases; a true 401 here means the session is gone.
  const { data } = await axios.post<{
    accessToken: string;
    refreshToken: string;
    expiresAt: string;
  }>(`${API_BASE_URL}/auth/refresh`, null, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  useAuthStore
    .getState()
    .setTokens(data.accessToken, data.refreshToken, data.expiresAt);
  return data.accessToken;
}

api.interceptors.request.use((config) => {
  const { accessToken } = useAuthStore.getState();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as RetriableConfig | undefined;
    const { accessToken } = useAuthStore.getState();

    // Endpoints where a 401 is a domain answer, not an expired session:
    // /auth/login and /auth/refresh are the login flow itself, and the
    // emailed-link routes are public. The server answers AUTH_INVALID_CREDENTIALS
    // (401) when a token was issued for an address the account no longer uses.
    // Refreshing and replaying there would burn the single-use token and, if the
    // refresh fails, hard-redirect a user who is mid-flow to /login.
    const nonRetriableAuthCall =
      original?.url?.includes("/auth/login") ||
      original?.url?.includes("/auth/refresh") ||
      original?.url?.includes("/auth/verify-email") ||
      original?.url?.includes("/auth/reset-password") ||
      original?.url?.includes("/auth/resend-verification") ||
      original?.url?.includes("/auth/forgot-password");

    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      accessToken &&
      !nonRetriableAuthCall
    ) {
      original._retry = true;
      try {
        // Coalesce concurrent 401s into a single refresh round-trip.
        refreshPromise ??= refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
        const token = await refreshPromise;
        original.headers.Authorization = `Bearer ${token}`;
        return api(original);
      } catch {
        useAuthStore.getState().clearSession();
        if (window.location.pathname !== "/login") {
          window.location.assign("/login");
        }
      }
    }

    return Promise.reject(error);
  },
);
