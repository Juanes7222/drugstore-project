import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@/common/exceptions/domain.exception';

/**
 * Thrown when the client asks for the status of a numbering-range sync job
 * that does not exist on the queue (unknown id, or already removed by
 * retention). 404, not a server error — the id came from the caller.
 */
export class DianSyncJobNotFoundException extends DomainException {
  constructor(jobId: string) {
    super(
      'DIAN_SYNC_JOB_NOT_FOUND',
      `No numbering-range sync job found for id "${jobId}"`,
      HttpStatus.NOT_FOUND,
    );
  }
}
