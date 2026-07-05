import { Prisma } from '@prisma/client';

export interface ReceiveStockFromClientReturnParams {
  lotId: string;
  quantity: number;
  clientReturnId: string;
  tx: Prisma.TransactionClient;
}
