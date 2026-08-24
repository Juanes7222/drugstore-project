import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SyncRequeueService } from './sync-requeue.service';
import { SyncOperationNotRequeueableException } from '../exceptions/sync-operation-not-requeueable.exception';

describe('SyncRequeueService', () => {
  let service: SyncRequeueService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new SyncRequeueService(prisma as any);
  });

  it('throws SyncOperationNotRequeueableException and updates nothing when no uuid is requeueable', async () => {
    (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([]);

    await expect(
      service.requeue(['op-done', 'op-running']),
    ).rejects.toThrow(SyncOperationNotRequeueableException);

    expect(prisma.syncQueue.findMany).toHaveBeenCalledWith({
      where: {
        operationUuid: { in: ['op-done', 'op-running'] },
        status: { in: ['FAILED', 'PERMANENT_FAILURE'] },
      },
      select: { id: true, operationUuid: true },
    });
    expect(prisma.syncQueue.updateMany).not.toHaveBeenCalled();
  });

  it('updates only the matched rows with a clean retry state on full match', async () => {
    (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([
      { id: 'row-1', operationUuid: 'op-fail' },
      { id: 'row-2', operationUuid: 'op-permanent' },
    ]);
    (prisma.syncQueue.updateMany as jest.Mock).mockResolvedValue({ count: 2 });

    const result = await service.requeue(['op-fail', 'op-permanent']);

    expect(prisma.syncQueue.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['row-1', 'row-2'] } },
      data: {
        status: 'PENDING',
        retryCount: 0,
        nextRetryAt: null,
        lastErrorMessage: null,
      },
    });
    expect(result).toEqual({
      requested: 2,
      requeued: ['op-fail', 'op-permanent'],
      skipped: [],
    });
  });

  it('reports non-requeueable uuids as skipped while requeueing the matched ones', async () => {
    // op-completed sits in COMPLETED server-side, so the identify query
    // never returns it; only the FAILED row comes back.
    (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([
      { id: 'row-9', operationUuid: 'op-failed' },
    ]);
    (prisma.syncQueue.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await service.requeue([
      'op-failed',
      'op-completed',
      'unknown-op',
    ]);

    expect(prisma.syncQueue.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['row-9'] } },
      data: expect.objectContaining({ status: 'PENDING' }),
    });
    expect(result.requested).toBe(3);
    expect(result.skipped).toEqual(['op-completed', 'unknown-op']);
  });

  it('requeues PERMANENT_FAILURE entries alongside FAILED ones', async () => {
    (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([
      { id: 'row-3', operationUuid: 'op-perm' },
    ]);
    (prisma.syncQueue.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const result = await service.requeue(['op-perm']);

    expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['FAILED', 'PERMANENT_FAILURE'] },
        }),
      }),
    );
    expect(result.requeued).toEqual(['op-perm']);
    expect(result.skipped).toEqual([]);
  });
});
