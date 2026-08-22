import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { useAuthStore } from '../hooks/use-auth';

export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export const api = axios.create({ baseURL: API_BASE_URL });

interface RetriableConfig extends InternalAxiosRequestConfig {
  _retry?: boolean;
}

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { accessToken } = useAuthStore.getState();
  if (!accessToken) {
    throw new Error('No active session');
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

    const isAuthCall =
      original?.url?.includes('/auth/login') ||
      original?.url?.includes('/auth/refresh');

    if (
      error.response?.status === 401 &&
      original &&
      !original._retry &&
      accessToken &&
      !isAuthCall
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
        if (window.location.pathname !== '/login') {
          window.location.assign('/login');
        }
      }
    }

    return Promise.reject(error);
  },
);