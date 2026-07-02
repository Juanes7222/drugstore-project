import { CreateSaleSchema } from '@pharmacy/shared-validation';
import { z } from 'zod';

export class CreateSaleDto implements z.infer<typeof CreateSaleSchema> {
  saleType!: 'FREE_SALE' | 'PRESCRIPTION' | 'CONTROLLED_SUBSTANCE';
  cashShiftId!: string;
  clientId?: string | null;
  items!: Array<{
    productId: string;
    quantity: number;
    unitPrice: string;
    discount?: string;
  }>;
  prescriptionNumber?: string | null;

  constructor(data?: z.infer<typeof CreateSaleSchema>) {
    if (data) {
      this.saleType = data.saleType;
      this.cashShiftId = data.cashShiftId;
      this.clientId = data.clientId;
      this.items = data.items;
      this.prescriptionNumber = data.prescriptionNumber;
    }
  }
}
