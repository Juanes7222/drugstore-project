import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { FiscalDianModule } from '@/modules/fiscal-dian/fiscal-dian.module';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { ConfigurationController } from './controllers/configuration.controller';
import { ConfigurationService } from './services/configuration.service';
import { PosSettingsService } from './services/pos-settings.service';

@Module({
  imports: [PrismaModule, AuthModule, FiscalDianModule],
  controllers: [ConfigurationController],
  providers: [ConfigurationService, PosSettingsService, SyncAuthGuard],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
