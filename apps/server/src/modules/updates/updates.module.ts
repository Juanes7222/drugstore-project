import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { ScheduleModule } from '@nestjs/schedule';
import { UpdatesController } from './updates.controller';
import { AdminUpdatesController } from './admin/admin-updates.controller';
import { UpdatesService } from './updates.service';
import { SignatureService } from './signature.service';
import { BinaryStorageService } from './binary-storage.service';
import { TelemetryService } from './telemetry.service';
import { RolloutAdvancementJob } from './jobs/rollout-advancement.job';

@Module({
  imports: [PrismaModule, ScheduleModule],
  controllers: [UpdatesController, AdminUpdatesController],
  providers: [
    UpdatesService,
    SignatureService,
    BinaryStorageService,
    TelemetryService,
    RolloutAdvancementJob,
  ],
  exports: [UpdatesService, TelemetryService],
})
export class UpdatesModule {}
