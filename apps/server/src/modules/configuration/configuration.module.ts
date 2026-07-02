import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { ConfigurationController } from './controllers/configuration.controller';
import { ConfigurationService } from './services/configuration.service';

@Module({
  imports: [PrismaModule],
  controllers: [ConfigurationController],
  providers: [ConfigurationService],
  exports: [ConfigurationService],
})
export class ConfigurationModule {}
