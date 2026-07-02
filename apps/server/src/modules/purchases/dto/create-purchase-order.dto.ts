import { CreatePurchaseOrderSchema } from './create-purchase-order.schema';
import { z } from 'zod';

export class CreatePurchaseOrderDto
  implements z.infer<typeof CreatePurchaseOrderSchema>
{
  supplierId!: string;
  notes?: string;
  items!: Array<{
    productId: string;
    quantity: string;
    unitPrice: string;
  }>;

  constructor(data?: z.infer<typeof CreatePurchaseOrderSchema>) {
    if (data) {
      this.supplierId = data.supplierId;
      this.notes = data.notes;
      this.items = data.items;
    }
  }
}
