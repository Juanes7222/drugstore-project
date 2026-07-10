jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { SyncProcessingJob } from './sync-processing.job';
import { SyncOperationDispatcherService } from '../sync-operation-dispatcher.service';

describe('SyncProcessingJob', () => {
  let job: SyncProcessingJob;
  let prisma: DeepMockProxy<PrismaClient>;
  let dispatcher: jest.Mocked<SyncOperationDispatcherService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    dispatcher = { dispatch: jest.fn() } as any;
    job = new SyncProcessingJob(prisma as any, dispatcher);
  });

  describe('processPendingOperations', () => {
    it('processes PENDING and retryable FAILED entries', async () => {
      const mockEntries = [
        {
          id: 'q-pending',
          operationType: 'SALE_CONFIRMATION',
          status: 'PENDING',
          retryCount: 0,
        },
        {
          id: 'q-failed',
          operationType: 'SHIFT_CLOSURE',
          status: 'FAILED',
          retryCount: 1,
          nextRetryAt: new Date(Date.now() - 1000),
        },
      ];
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue(mockEntries);
      (prisma.syncQueue.update as jest.Mock).mockResolvedValue({});
      dispatcher.dispatch.mockResolvedValue(undefined);

      await job.processPendingOperations();

      expect(prisma.syncQueue.update).toHaveBeenCalledTimes(4); // 2 entries × (PROCESSING + COMPLETED)
      expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
    });

    it('marks entry as FAILED when dispatch throws', async () => {
      const mockEntries = [
        { id: 'q-err', operationType: 'SALE_CONFIRMATION', status: 'PENDING', retryCount: 0 },
      ];
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue(mockEntries);
      (prisma.syncQueue.update as jest.Mock).mockResolvedValue({});
      dispatcher.dispatch.mockRejectedValue(new Error('Network error'));

      await job.processPendingOperations();

      // Called once for PROCESSING, once for FAILED
      expect(prisma.syncQueue.update).toHaveBeenCalledTimes(2);
      expect(prisma.syncQueue.update).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 'q-err' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('does nothing when no entries are available', async () => {
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([]);

      await job.processPendingOperations();

      expect(prisma.syncQueue.update).not.toHaveBeenCalled();
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });
  });
});
