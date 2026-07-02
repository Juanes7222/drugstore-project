import { Module } from '@nestjs/common';
import { PrismaModule } from '@/infrastructure/prisma/prisma.module';
import { CashShiftController } from './cash-shift.controller';
import { CashShiftService } from './cash-shift.service';

@Module({
  imports: [PrismaModule],
  controllers: [CashShiftController],
  providers: [CashShiftService],
  exports: [CashShiftService],
})
export class CashShiftModule {}
