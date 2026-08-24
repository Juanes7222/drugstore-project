import { DomainException } from '@/common/exceptions/domain.exception';
import { HttpStatus } from '@nestjs/common';

/**
 * Thrown when a requeue request matches no queue entry in a requeueable
 * state. COMPLETED and PROCESSING entries must never be re-queued: the
 * former would duplicate an already-applied movement, the latter is being
 * worked on by a live processor.
 */
export class SyncOperationNotRequeueableException extends DomainException {
  constructor(operationUuids: string[]) {
    super(
      'SYNC_OPERATION_NOT_REQUEUEABLE',
      `No requeueable sync operations found for: ${operationUuids.join(', ')}`,
      HttpStatus.CONFLICT,
    );
  }
}
