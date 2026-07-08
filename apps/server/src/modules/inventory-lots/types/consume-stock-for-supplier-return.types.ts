import { Prisma } from '@pharmacy/database';

export interface ConsumeStockForSupplierReturnParams {
  lotId: string;
  quantity: number;
  supplierReturnId: string;
  tx: Prisma.TransactionClient;
}
