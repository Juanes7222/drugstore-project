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
import { createLocalStorageAuthTokenProvider } from './auth-token-provider';
import { API_BASE_URL } from './config';

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
    createLocalStorageAuthTokenProvider(),
  );

  return createHttpCatalogService({ httpClient });
}
