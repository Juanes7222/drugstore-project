/**
 * Factory that creates the appropriate `CatalogService` implementation based
 * on the environment configuration.
 *
 * When `VITE_API_BASE_URL` is set, the real HTTP-backed service is returned.
 * Otherwise a mock service is used so the UI is functional during early
 * development without a running server.
 */
import { type CatalogService } from '../renderer/services/catalog-service';
import { createHttpCatalogService } from '../renderer/services/catalog-service.http';
import { createMockCatalogService } from '../renderer/services/catalog-service.mock';
import { createHttpClient } from './http-client';
import { API_BASE_URL } from './config';

/**
 * AuthTokenProvider that reads the session's access token from the Zustand
 * in-memory store — the single source of truth for auth state.  This replaces
 * the localStorage-based provider that was never written to.
 */
const createZustandAuthTokenProvider = () => ({
  getAccessToken: async (): Promise<string | null> => {
    const { useLocalSessionStore } = await import(
      '../domain/auth/local-session.store'
    );
    return useLocalSessionStore.getState().session?.accessToken ?? null;
  },
});

export function createCatalogService(): CatalogService {
  if (!API_BASE_URL) {
    // eslint-disable-next-line no-console
    console.warn(
      'VITE_API_BASE_URL is not set; falling back to mock catalog service.',
    );
    return createMockCatalogService();
  }

  const httpClient = createHttpClient(
    API_BASE_URL,
    createZustandAuthTokenProvider(),
  );

  return createHttpCatalogService({ httpClient });
}
