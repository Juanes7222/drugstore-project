import { SyncBatchSchema } from './sync-operation.schema';
import { z } from 'zod';

export class SyncBatchDto implements z.infer<typeof SyncBatchSchema> {
  operations!: Array<{
    operationType: 'SALE_CONFIRMATION' | 'SHIFT_CLOSURE' | 'CLIENT_CREATION' | 'INVENTORY_ADJUSTMENT' | 'FISCAL_DOCUMENT_SYNC' | 'PRESCRIPTION_REGISTRATION' | 'RESOLUTION_ALLOCATION';
    operationUuid: string;
    payload: Record<string, any>;
    payloadHash: string;
    sourceCreatedAt: string;
    clientSequence: number;
  }>;

  constructor(data?: z.infer<typeof SyncBatchSchema>) {
    if (data) {
      this.operations = data.operations;
    }
  }
}
