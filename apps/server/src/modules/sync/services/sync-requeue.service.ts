/**
 * Admin remediation for failed sync operations — the server-side
 * replacement for the POS client's local "discard" action, which must not
 * exist for business movements: discarding creates holes in the movement
 * sequence that no later process can repair. Requeueing re-runs the
 * operation through the idempotent dispatcher instead of dropping it.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { SyncStatus } from '@pharmacy/database';
import { SyncOperationNotRequeueableException } from '../exceptions/sync-operation-not-requeueable.exception';

/** Only these states may return to PENDING. */
const REQUEUEABLE_STATUSES: SyncStatus[] = ['FAILED', 'PERMANENT_FAILURE'];

export interface RequeueResult {
  requested: number;
  requeued: string[];
  skipped: string[];
}

@Injectable()
export class SyncRequeueService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns FAILED / PERMANENT_FAILURE entries for the given uuids to
   * PENDING with a clean retry state. Uuids in any other state are
   * reported as `skipped`; if none is requeueable the whole call fails so
   * a stale UI cannot silently no-op.
   */
  async requeue(operationUuids: string[]): Promise<RequeueResult> {
    // Identify first, then update by primary key: updateMany alone cannot
    // report WHICH entries matched, and a status-based read-back after the
    // update would misclassify entries that were already PENDING.
    const requeueable = await this.prisma.syncQueue.findMany({
      where: {
        operationUuid: { in: operationUuids },
        status: { in: [...REQUEUEABLE_STATUSES] },
      },
      select: { id: true, operationUuid: true },
    });

    if (requeueable.length === 0) {
      throw new SyncOperationNotRequeueableException(operationUuids);
    }

    await this.prisma.syncQueue.updateMany({
      where: { id: { in: requeueable.map((row) => row.id) } },
      data: {
        status: SyncStatus.PENDING,
        retryCount: 0,
        nextRetryAt: null,
        lastErrorMessage: null,
      },
    });

    const requeued = requeueable.map((row) => row.operationUuid);
    const requeuedSet = new Set(requeued);

    return {
      requested: operationUuids.length,
      requeued,
      skipped: operationUuids.filter((uuid) => !requeuedSet.has(uuid)),
    };
  }
}
