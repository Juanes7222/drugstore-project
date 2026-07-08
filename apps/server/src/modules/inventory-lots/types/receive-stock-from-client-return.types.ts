import { Prisma } from '@pharmacy/database';

export interface ReceiveStockFromClientReturnParams {
  lotId: string;
  quantity: number;
  clientReturnId: string;
  tx: Prisma.TransactionClient;
}
