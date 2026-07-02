import { SyncBatchSchema } from './sync-operation.schema';
import { z } from 'zod';

export class SyncBatchDto implements z.infer<typeof SyncBatchSchema> {
  operations!: Array<{
    operationType: 'CREATE_SALE' | 'UPDATE_SALE' | 'CREATE_ADJUSTMENT' | 'UPDATE_ADJUSTMENT' | 'CREATE_PURCHASE_ORDER' | 'UPDATE_PURCHASE_ORDER' | 'SYNC_CATALOG';
    payload: Record<string, any>;
    payloadHash: string;
    sourceWorkstationId: string;
    sourceCreatedAt: string;
    clientSequence: number;
  }>;

  constructor(
    data?: z.infer<typeof SyncBatchSchema>,
  ) {
    if (data) {
      this.operations = data.operations;
    }
  }
}
