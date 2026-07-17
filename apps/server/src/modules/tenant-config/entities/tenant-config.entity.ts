// ---------------------------------------------------------------------------
// Response entity type for TenantConfig.
// Strips the sensitive dianTechnicalKey from the fiscal section before
// returning to clients. The key is retained in the database but never
// included in API responses.
// ---------------------------------------------------------------------------

import type {
  TenantConfig,
  FiscalConfig,
} from '@pharmacy/shared-types';

export type { TenantConfig as TenantConfigEntity };

/** Configuration field path for changelog tracking. */
export type ConfigFieldPath =
  | `strictness.${string}`
  | `fiscal.${string}`
  | `workflow.${string}`
  | 'customCompanyFields'
  | 'customStrictnessToggles';

/**
 * Strips the dianTechnicalKey from the fiscal section.
 * Returns a deep-cloned object safe for client consumption.
 */
export function sanitizeTenantConfig(
  config: TenantConfig,
): TenantConfig {
  const safeFiscal: FiscalConfig = {
    ...config.fiscal,
    dianTechnicalKey: '', // always blank — never leak to client
  };

  return {
    ...config,
    fiscal: safeFiscal,
  };
}
