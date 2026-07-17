import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { TenantConfigController } from './controllers/tenant-config.controller';
import { NamedPresetsController } from './controllers/named-presets.controller';
import { AdminConfigController } from './controllers/admin-config.controller';
import { TenantConfigService } from './services/tenant-config.service';
import { ConfigValidationService } from './services/config-validation.service';
import { ConfigSyncService } from './services/config-sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    TenantConfigController,
    NamedPresetsController,
    AdminConfigController,
  ],
  providers: [
    TenantConfigService,
    ConfigValidationService,
    ConfigSyncService,
  ],
  exports: [TenantConfigService, ConfigSyncService],
})
export class TenantConfigModule {}
