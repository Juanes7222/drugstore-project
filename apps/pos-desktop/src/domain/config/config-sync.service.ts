/**
 * Tenant config sync service — pulls tenant config from the server
 * during each sync cycle and hydrates the Zustand store.
 *
 * Part of the sync-scheduler's tick cycle, executed after the
 * regular configuration sync (which pulls payment methods, etc.)
 * and before catalog sync.
 */

import { isOnline } from '../../common/is-online';
import type { TenantConfigSyncPayload } from './types';
import { useTenantConfigStore } from './tenant-config.store';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TenantConfigSyncConfig {
  /** Server base URL. */
  baseUrl: string;
  /** Optional override of the HTTP client (for testing). */
  httpClient?: SyncHttpClient;
  /** Optional auth token for protected endpoints. */
  accessToken?: string;
}

export interface TenantConfigSyncService {
  /** Pull the tenant config and hydrate the store. Safe to call when offline. */
  pullTenantConfig(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Default HTTP client
// ---------------------------------------------------------------------------

export interface SyncHttpClient {
  get<T>(url: string, headers?: Record<string, string>): Promise<T>;
}

const defaultHttpClient: SyncHttpClient = {
  get: async <T>(url: string, headers?: Record<string, string>): Promise<T> => {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new TenantConfigSyncHttpError(url, response.status, await response.text());
    }
    return response.json() as Promise<T>;
  },
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTenantConfigSyncService(
  config: TenantConfigSyncConfig,
): TenantConfigSyncService {
  const http = config.httpClient ?? defaultHttpClient;
  const baseUrl = config.baseUrl.replace(/\/+$/, '');

  const buildHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {};
    if (config.accessToken) {
      headers.Authorization = `Bearer ${config.accessToken}`;
    }
    return headers;
  };

  return {
    async pullTenantConfig(): Promise<void> {
      if (!isOnline()) return;

      try {
        const headers = buildHeaders();
        const payload = await http.get<TenantConfigSyncPayload>(
          `${baseUrl}/tenant-config/sync`,
          headers,
        );

        // Hydrate the Zustand store with the full config
        const store = useTenantConfigStore;
        store.getState().setConfig(payload.config);

        // Update presets list if provided
        if (payload.presets && payload.presets.length > 0) {
          const presets = payload.presets.map((p) => ({
            code: p.code,
            name: p.name,
            description: p.description,
          }));
          store.getState().setPresets(presets);
        }
      } catch {
        // Network error or offline — the store keeps the last known config.
        // This is safe to swallow because the sync cycle continues with
        // the cached config.
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class TenantConfigSyncHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(url: string, statusCode: number, responseBody: string) {
    super(
      `Tenant config sync HTTP error ${statusCode} for ${url}: ${responseBody}`,
    );
    this.name = 'TenantConfigSyncHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
