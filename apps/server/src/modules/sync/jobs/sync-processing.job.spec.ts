import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { SyncProcessingJob } from './sync-processing.job';
import { SyncOperationDispatcherService } from '../sync-operation-dispatcher.service';
import { CashShiftNotOpenForWorkstationException } from '../../sales-pos/exceptions/cash-shift-not-open-for-workstation.exception';
import { ProductNotFoundException } from '../../catalog/exceptions/product-not-found.exception';

describe('SyncProcessingJob', () => {
  let job: SyncProcessingJob;
  let prisma: DeepMockProxy<PrismaClient>;
  let dispatcher: jest.Mocked<SyncOperationDispatcherService>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withTenant executes the callback with the mock itself (no real tenant transaction).
    (prisma.withTenant as jest.Mock).mockImplementation(
      async (_subscriptionId: string, fn: () => Promise<void>) => fn(),
    );
    dispatcher = { dispatch: jest.fn() } as any;
    job = new SyncProcessingJob(prisma as any, dispatcher);
  });

  describe('processPendingOperations', () => {
    it('processes PENDING and retryable FAILED entries', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([{ id: 'sub-1' }]);
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
      (prisma.syncQueue.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      // Dispatch must resolve a real result shape — an undefined result
      // would throw on result.entityId and route through markFailed.
      dispatcher.dispatch.mockResolvedValue({
        entityId: 'entity-1',
        entityInternalCode: 'code-1',
      });

      await job.processPendingOperations();

      // 1 atomic claim (updateMany) + 1 COMPLETED update per entry
      expect(prisma.syncQueue.updateMany).toHaveBeenCalledTimes(2);
      expect(prisma.syncQueue.update).toHaveBeenCalledTimes(2);
      expect(prisma.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-pending' },
          data: expect.objectContaining({ status: 'COMPLETED' }),
        }),
      );
      expect(dispatcher.dispatch).toHaveBeenCalledTimes(2);
    });

    it('marks entry as FAILED when dispatch throws', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([{ id: 'sub-1' }]);
      const mockEntries = [
        { id: 'q-err', operationType: 'SALE_CONFIRMATION', status: 'PENDING', retryCount: 0 },
      ];
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue(mockEntries);
      (prisma.syncQueue.update as jest.Mock).mockResolvedValue({});
      (prisma.syncQueue.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      dispatcher.dispatch.mockRejectedValue(new Error('Network error'));

      await job.processPendingOperations();

      // Called once for FAILED — the PROCESSING claim is now updateMany
      expect(prisma.syncQueue.update).toHaveBeenCalledTimes(1);
      expect(prisma.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-err' },
          data: expect.objectContaining({ status: 'FAILED' }),
        }),
      );
    });

    it('does nothing when no entries are available', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([{ id: 'sub-1' }]);
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([]);

      await job.processPendingOperations();

      expect(prisma.syncQueue.update).not.toHaveBeenCalled();
      expect(dispatcher.dispatch).not.toHaveBeenCalled();
    });

    it('skips dispatch when the atomic claim returns a zero count', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([{ id: 'sub-1' }]);
      const mockEntries = [
        { id: 'q-contested', operationType: 'SALE_CONFIRMATION', status: 'PENDING', retryCount: 0 },
      ];
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue(mockEntries);
      // Zero count = another processor already moved the row out of a
      // claimable status between fetch and claim.
      (prisma.syncQueue.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await job.processPendingOperations();

      expect(dispatcher.dispatch).not.toHaveBeenCalled();
      expect(prisma.syncQueue.update).not.toHaveBeenCalled();
    });

    it('marks entry as retriable FAILED when dispatcher throws CashShiftNotOpenForWorkstationException', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([{ id: 'sub-1' }]);
      const mockEntries = [
        { id: 'q-cash-shift', operationType: 'SALE_CONFIRMATION', status: 'PENDING', retryCount: 0 },
      ];
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue(mockEntries);
      (prisma.syncQueue.update as jest.Mock).mockResolvedValue({});
      (prisma.syncQueue.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      dispatcher.dispatch.mockRejectedValue(
        new CashShiftNotOpenForWorkstationException('ws-1'),
      );

      await job.processPendingOperations();

      // Transient during replay bursts — FAILED with a scheduled retry,
      // never PERMANENT_FAILURE.
      expect(prisma.syncQueue.update).toHaveBeenCalledTimes(1);
      expect(prisma.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-cash-shift' },
          data: expect.objectContaining({
            status: 'FAILED',
            retryCount: 1,
            nextRetryAt: expect.any(Date),
            lastErrorMessage: 'No open cash shift found for workstation ws-1.',
          }),
        }),
      );
    });

    it('marks entry as PERMANENT_FAILURE when dispatcher throws another DomainException subclass', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([{ id: 'sub-1' }]);
      const mockEntries = [
        { id: 'q-product', operationType: 'SALE_CONFIRMATION', status: 'PENDING', retryCount: 0 },
      ];
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue(mockEntries);
      (prisma.syncQueue.update as jest.Mock).mockResolvedValue({});
      (prisma.syncQueue.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      dispatcher.dispatch.mockRejectedValue(new ProductNotFoundException('prod-1'));

      await job.processPendingOperations();

      expect(prisma.syncQueue.update).toHaveBeenCalledTimes(1);
      expect(prisma.syncQueue.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'q-product' },
          data: expect.objectContaining({
            status: 'PERMANENT_FAILURE',
            retryCount: 1,
            nextRetryAt: null,
          }),
        }),
      );
    });
  });
});
