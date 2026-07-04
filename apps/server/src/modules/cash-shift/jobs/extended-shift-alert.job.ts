import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CashShiftService } from '../cash-shift.service';

const EXTENDED_SHIFT_CHECK_INTERVAL = CronExpression.EVERY_30_MINUTES;

@Injectable()
export class ExtendedShiftAlertJob {
  constructor(private cashShiftService: CashShiftService) {}

  @Cron(EXTENDED_SHIFT_CHECK_INTERVAL)
  async flagExtendedShifts(): Promise<void> {
    await this.cashShiftService.flagExtendedShifts();
  }
}
