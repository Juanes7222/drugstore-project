import { CreateCashShiftSchema } from './create-cash-shift.schema';
import { z } from 'zod';

export class CreateCashShiftDto implements z.infer<typeof CreateCashShiftSchema> {
  workstationId!: string;
  openedByUserId!: string;
  baseCashAmount!: string;
  notes?: string;

  constructor(data?: z.infer<typeof CreateCashShiftSchema>) {
    if (data) {
      this.workstationId = data.workstationId;
      this.openedByUserId = data.openedByUserId;
      this.baseCashAmount = data.baseCashAmount;
      this.notes = data.notes;
    }
  }
}
