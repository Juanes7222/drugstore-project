export { TenantConfigModule } from './tenant-config.module';
export { TenantConfigService } from './services/tenant-config.service';
export { ConfigValidationService } from './services/config-validation.service';
export { ConfigSyncService } from './services/config-sync.service';
export { WorkstationConfigService } from './services/workstation-config.service';

// Exceptions
export { ConfigVersionConflictException } from './exceptions/config-version-conflict.exception';
export { ConfigValidationException } from './exceptions/config-validation.exception';
export { PresetNotFoundException } from './exceptions/preset-not-found.exception';

// DTOs
export { UpdateTenantConfigDto } from './dto/update-tenant-config.dto';
export { ApplyPresetDto } from './dto/apply-preset.dto';
export { CreateNamedPresetDto, UpdateNamedPresetDto } from './dto/named-preset.dto';
export { AddCustomFieldDto, UpdateCustomFieldDto } from './dto/custom-field.dto';
export { AddCustomToggleDto, UpdateCustomToggleDto } from './dto/custom-toggle.dto';

// Entity
export { sanitizeTenantConfig } from './entities/tenant-config.entity';
export type { ConfigFieldPath } from './entities/tenant-config.entity';

// Validation
export type { ValidationError } from './services/config-validation.service';
