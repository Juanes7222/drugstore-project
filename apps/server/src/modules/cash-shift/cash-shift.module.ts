import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { AuthModule } from '@/modules/auth/auth.module';
import { SyncAuthGuard } from '@/modules/sync/guards/sync-auth.guard';
import { CashShiftController } from './cash-shift.controller';
import { CashShiftService } from './cash-shift.service';
import { ExtendedShiftAlertJob } from './jobs/extended-shift-alert.job';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CashShiftController],
  providers: [CashShiftService, ExtendedShiftAlertJob, SyncAuthGuard],
  exports: [CashShiftService],
})
export class CashShiftModule {}
