import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { CashShiftController } from './cash-shift.controller';
import { CashShiftService } from './cash-shift.service';
import { ExtendedShiftAlertJob } from './jobs/extended-shift-alert.job';

@Module({
  imports: [PrismaModule],
  controllers: [CashShiftController],
  providers: [CashShiftService, ExtendedShiftAlertJob],
  exports: [CashShiftService],
})
export class CashShiftModule {}
