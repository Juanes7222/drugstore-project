import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { ConfigurationController } from './controllers/configuration.controller';
import { ConfigurationService } from './services/configuration.service';
import { PosSettingsService } from './services/pos-settings.service';

@Module({
  imports: [PrismaModule],
  controllers: [ConfigurationController],
  providers: [ConfigurationService, PosSettingsService],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
