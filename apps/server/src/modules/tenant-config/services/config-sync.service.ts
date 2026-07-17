// ---------------------------------------------------------------------------
// ConfigSyncService — exposes tenant configuration for POS desktop sync.
// Called by the sync module when a workstation initiates a sync cycle.
// ---------------------------------------------------------------------------

import { Injectable } from '@nestjs/common';
import { TenantConfigService } from './tenant-config.service';
import type { TenantConfigSyncPayload } from '@pharmacy/shared-types';

/**
 * Thin facade over TenantConfigService that the sync module imports.
 * Keeps the sync module from depending directly on the full service.
 */
@Injectable()
export class ConfigSyncService {
  constructor(private tenantConfigService: TenantConfigService) {}

  /**
   * Returns the current tenant config + preset definitions for POS sync.
   */
  async getConfigForSync(
    subscriptionId: string,
  ): Promise<TenantConfigSyncPayload> {
    return this.tenantConfigService.getSyncPayload(subscriptionId);
  }
}
