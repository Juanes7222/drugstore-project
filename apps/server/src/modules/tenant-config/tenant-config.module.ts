import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { TenantConfigController } from './controllers/tenant-config.controller';
import { NamedPresetsController } from './controllers/named-presets.controller';
import { AdminConfigController } from './controllers/admin-config.controller';
import { WorkstationConfigController } from './controllers/workstation-config.controller';
import { TenantConfigService } from './services/tenant-config.service';
import { ConfigValidationService } from './services/config-validation.service';
import { ConfigSyncService } from './services/config-sync.service';
import { WorkstationConfigService } from './services/workstation-config.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    TenantConfigController,
    NamedPresetsController,
    AdminConfigController,
    WorkstationConfigController,
  ],
  providers: [
    TenantConfigService,
    ConfigValidationService,
    ConfigSyncService,
    WorkstationConfigService,
  ],
  exports: [TenantConfigService, ConfigSyncService],
})
export class TenantConfigModule {}
