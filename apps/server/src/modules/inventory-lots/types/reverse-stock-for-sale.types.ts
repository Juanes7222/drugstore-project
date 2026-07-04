import { Prisma } from '@prisma/client';

export interface ReverseStockForSaleParams {
  saleId: string;
  tx: Prisma.TransactionClient;
}

export interface ReversedSaleLot {
  lotId: string;
  quantity: number;
}
