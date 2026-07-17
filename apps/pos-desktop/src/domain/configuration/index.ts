export {
  createConfigSyncService,
  ConfigSyncService,
  ConfigSyncHttpError,
  type ConfigSyncConfig,
  type PosSettingsPayload,
} from './config-sync.service';
export {
  useLocalConfigStore,
  getLocalConfigState,
  getTenantInfo,
  type LocalConfigState,
  type DiscountLimits,
  type AlertThresholds,
  type SyncDefaults,
  type RoleDiscountLimit,
  type TenantInfo,
} from './local-config.store';