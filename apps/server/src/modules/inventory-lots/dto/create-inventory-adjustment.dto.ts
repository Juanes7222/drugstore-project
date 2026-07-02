import { CreateInventoryAdjustmentSchema } from './create-inventory-adjustment.schema';
import { z } from 'zod';

export class CreateInventoryAdjustmentDto
  implements z.infer<typeof CreateInventoryAdjustmentSchema>
{
  reason!: string;
  notes?: string;
  items!: Array<{
    lotId: string;
    quantityAdjustment: string;
    unitCost: string;
  }>;

  constructor(data?: z.infer<typeof CreateInventoryAdjustmentSchema>) {
    if (data) {
      this.reason = data.reason;
      this.notes = data.notes;
      this.items = data.items;
    }
  }
}
