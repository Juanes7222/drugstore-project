import { SyncBatchSchema, SyncOperationInput } from './sync-operation.schema';
import { z } from 'zod';

/**
 * Wrapper around the validated array. The ZodValidationPipe validates against
 * SyncBatchSchema (a plain array), then the controller constructs this DTO
 * to pass into SyncService.
 */
export class SyncBatchDto {
  operations: SyncOperationInput[];

  constructor(data: z.infer<typeof SyncBatchSchema>) {
    this.operations = data;
  }
}
