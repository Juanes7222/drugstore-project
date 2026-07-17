/**
 * Config service — tenant configuration HTTP client.
 *
 * Fetches and updates tenant config from the NestJS server.
 * Follows the same factory-function + interface pattern as other domain services.
 */

import type {
  TenantConfig,
  TenantConfigSyncPayload,
  NamedPreset,
  CustomCompanyField,
  CustomStrictnessToggle,
  ConfigChangelogEntry,
  PresetCode,
} from './types';
import { PRESET_LIST } from './presets';

// ---------------------------------------------------------------------------
// Config HTTP client interface
// ---------------------------------------------------------------------------

export interface ConfigHttpClient {
  get<T>(path: string): Promise<T>;
  put<T>(path: string, body: unknown): Promise<T>;
  post<T>(path: string, body?: unknown): Promise<T>;
  patch<T>(path: string, body?: unknown): Promise<T>;
  delete<T>(path: string): Promise<T>;
}

// ---------------------------------------------------------------------------
// Config service interface
// ---------------------------------------------------------------------------

export interface ConfigService {
  /** Fetch the current tenant config. */
  getCurrent(): Promise<TenantConfig>;

  /** Update the tenant config. */
  update(
    config: Partial<TenantConfig>,
    expectedVersion: number,
  ): Promise<TenantConfig>;

  /** Apply a standard preset. */
  applyPreset(presetCode: PresetCode): Promise<TenantConfig>;

  /** Reset to active preset values, removing overrides. */
  resetToPreset(): Promise<TenantConfig>;

  /** Add a custom company info field. */
  addCustomField(field: CustomCompanyField): Promise<TenantConfig>;

  /** Update a custom company info field. */
  updateCustomField(
    fieldId: string,
    updates: Partial<CustomCompanyField>,
  ): Promise<TenantConfig>;

  /** Remove a custom company info field. */
  removeCustomField(fieldId: string): Promise<TenantConfig>;

  /** Add a custom strictness toggle. */
  addCustomToggle(toggle: CustomStrictnessToggle): Promise<TenantConfig>;

  /** Update a custom strictness toggle. */
  updateCustomToggle(
    toggleId: string,
    updates: Partial<CustomStrictnessToggle>,
  ): Promise<TenantConfig>;

  /** Remove a custom strictness toggle. */
  removeCustomToggle(toggleId: string): Promise<TenantConfig>;

  /** Get config change history. */
  getHistory(): Promise<ConfigChangelogEntry[]>;

  /** Rollback to a previous config version. */
  rollback(version: number): Promise<TenantConfig>;

  /** Save current config as a named preset. */
  saveAsNamedPreset(
    name: string,
    description?: string,
    isShared?: boolean,
  ): Promise<NamedPreset>;

  /** List saved named presets. */
  listNamedPresets(): Promise<NamedPreset[]>;

  /** Apply a named preset. */
  applyNamedPreset(presetId: string): Promise<TenantConfig>;

  /** Delete a named preset. */
  deleteNamedPreset(presetId: string): Promise<void>;

  /** Get config + preset definitions for sync. */
  getSyncPayload(): Promise<TenantConfigSyncPayload>;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateConfigServiceOptions {
  httpClient: ConfigHttpClient;
}

export function createConfigService(
  options: CreateConfigServiceOptions,
): ConfigService {
  const client = options.httpClient;

  return {
    async getCurrent(): Promise<TenantConfig> {
      return client.get<TenantConfig>('/tenant-config');
    },

    async update(
      config: Partial<TenantConfig>,
      expectedVersion: number,
    ): Promise<TenantConfig> {
      return client.put<TenantConfig>('/tenant-config', {
        ...config,
        expectedConfigVersion: expectedVersion,
      });
    },

    async applyPreset(presetCode: PresetCode): Promise<TenantConfig> {
      return client.post<TenantConfig>('/tenant-config/apply-preset', {
        presetCode,
      });
    },

    async resetToPreset(): Promise<TenantConfig> {
      return client.post<TenantConfig>('/tenant-config/reset-to-preset');
    },

    async addCustomField(field: CustomCompanyField): Promise<TenantConfig> {
      return client.post<TenantConfig>('/tenant-config/custom-fields', field);
    },

    async updateCustomField(
      fieldId: string,
      updates: Partial<CustomCompanyField>,
    ): Promise<TenantConfig> {
      return client.patch<TenantConfig>(
        `/tenant-config/custom-fields/${fieldId}`,
        updates,
      );
    },

    async removeCustomField(fieldId: string): Promise<TenantConfig> {
      return client.delete<TenantConfig>(
        `/tenant-config/custom-fields/${fieldId}`,
      );
    },

    async addCustomToggle(
      toggle: CustomStrictnessToggle,
    ): Promise<TenantConfig> {
      return client.post<TenantConfig>(
        '/tenant-config/custom-toggles',
        toggle,
      );
    },

    async updateCustomToggle(
      toggleId: string,
      updates: Partial<CustomStrictnessToggle>,
    ): Promise<TenantConfig> {
      return client.patch<TenantConfig>(
        `/tenant-config/custom-toggles/${toggleId}`,
        updates,
      );
    },

    async removeCustomToggle(toggleId: string): Promise<TenantConfig> {
      return client.delete<TenantConfig>(
        `/tenant-config/custom-toggles/${toggleId}`,
      );
    },

    async getHistory(): Promise<ConfigChangelogEntry[]> {
      return client.get<ConfigChangelogEntry[]>(
        '/tenant-config/history',
      );
    },

    async rollback(version: number): Promise<TenantConfig> {
      return client.post<TenantConfig>(
        `/tenant-config/rollback/${version}`,
      );
    },

    async saveAsNamedPreset(
      name: string,
      description?: string,
      isShared?: boolean,
    ): Promise<NamedPreset> {
      return client.post<NamedPreset>('/tenant-config/named-presets', {
        name,
        description,
        isShared,
      });
    },

    async listNamedPresets(): Promise<NamedPreset[]> {
      return client.get<NamedPreset[]>('/tenant-config/named-presets');
    },

    async applyNamedPreset(presetId: string): Promise<TenantConfig> {
      return client.post<TenantConfig>(
        `/tenant-config/named-presets/${presetId}/apply`,
      );
    },

    async deleteNamedPreset(presetId: string): Promise<void> {
      await client.delete<void>(`/tenant-config/named-presets/${presetId}`);
    },

    async getSyncPayload(): Promise<TenantConfigSyncPayload> {
      // Include local preset definitions for offline reference
      const config = await client.get<TenantConfig>(
        '/tenant-config',
      );
      return {
        config,
        presets: PRESET_LIST.map((p) => ({
          code: p.code,
          name: p.name,
          description: p.description,
          strictness: p.strictness,
          fiscal: p.fiscal,
          workflow: p.workflow,
        })),
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Default HTTP implementation
// ---------------------------------------------------------------------------

export interface DefaultConfigHttpClientOptions {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
}

/**
 * Create a ConfigHttpClient using native fetch.
 */
export function createDefaultConfigHttpClient(
  options: DefaultConfigHttpClientOptions,
): ConfigHttpClient {
  const { baseUrl, getAccessToken } = options;
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await getAccessToken();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new ConfigHttpError(
        response.status,
        text,
        `Config HTTP ${method} ${path} failed: ${response.status}`,
      );
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
    post: <T>(path: string, body?: unknown) =>
      request<T>('POST', path, body),
    patch: <T>(path: string, body?: unknown) =>
      request<T>('PATCH', path, body),
    delete: <T>(path: string) => request<T>('DELETE', path),
  };
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ConfigHttpError extends Error {
  readonly statusCode: number;
  readonly responseBody: string;

  constructor(statusCode: number, responseBody: string, message: string) {
    super(message);
    this.name = 'ConfigHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
