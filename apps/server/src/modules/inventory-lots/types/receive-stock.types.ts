import { Prisma } from '@pharmacy/database';

export interface ReceiveStockParams {
  productId: string;
  quantity: number;
  unitCost: Prisma.Decimal;
  batchNumber: string;
  expirationDate: Date;
  locationCode?: string;
  purchaseReceptionId?: string;
  tx: Prisma.TransactionClient;
}

export interface ReceivedLot {
  lotId: string;
}
