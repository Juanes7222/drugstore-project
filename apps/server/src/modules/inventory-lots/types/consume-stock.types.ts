import { Prisma } from '@prisma/client';

export interface ConsumeStockForSaleParams {
  productId: string;
  quantity: number;
  saleId: string;
  tx: Prisma.TransactionClient;
}

export interface ConsumedLot {
  lotId: string;
  quantity: number;
  unitCostAtSale: Prisma.Decimal;
}
