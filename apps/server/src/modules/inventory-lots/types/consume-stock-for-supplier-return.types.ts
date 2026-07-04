import { Prisma } from '@prisma/client';

export interface ConsumeStockForSupplierReturnParams {
  lotId: string;
  quantity: number;
  supplierReturnId: string;
  tx: Prisma.TransactionClient;
}
