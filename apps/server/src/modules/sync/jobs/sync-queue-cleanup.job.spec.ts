import {
  createPrismaDatabaseMock,
  SYNC_STATUS_VALUES,
} from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Logger } from '@nestjs/common';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { SyncQueueCleanupJob } from './sync-queue-cleanup.job';

describe('SyncQueueCleanupJob', () => {
  let job: SyncQueueCleanupJob;
  let prisma: DeepMockProxy<PrismaClient>;
  let configService: { getOrThrow: jest.Mock };
  let loggerLog: jest.SpyInstance;

  // Frozen clock so the retention cutoff is an exact Date we can assert on.
  const FIXED_NOW = Date.UTC(2026, 7, 25, 0, 0, 0);
  const PURGE_BATCH_SIZE = 500;

  // Per-tenant queues of findMany results. The withTenant stub remembers the
  // active subscription so the syncQueue.findMany stub can branch per tenant
  // (the real tenant scoping happens inside withTenant via RLS).
  let currentTenantId: string;
  let batchesByTenant: Record<string, Array<Array<{ id: string }>>>;

  function queueBatch(tenantId: string, count: number, prefix: string): void {
    batchesByTenant[tenantId] ??= [];
    batchesByTenant[tenantId].push(
      Array.from({ length: count }, (_, i) => ({ id: `${prefix}-${i}` })),
    );
  }

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);
    loggerLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    prisma = mockDeep<PrismaClient>();
    (prisma.withTenant as jest.Mock).mockImplementation(
      async (subscriptionId: string, fn: () => Promise<number>) => {
        currentTenantId = subscriptionId;
        return fn();
      },
    );
    (prisma.syncQueue.findMany as jest.Mock).mockImplementation(async () => {
      const queue = batchesByTenant[currentTenantId] ?? [];
      return queue.shift() ?? [];
    });
    (prisma.syncQueue.deleteMany as jest.Mock).mockImplementation(
      async (args: { where: { id: { in: string[] } } }) => ({
        count: args.where.id.in.length,
      }),
    );

    configService = { getOrThrow: jest.fn().mockReturnValue(30) };

    currentTenantId = '';
    batchesByTenant = {};

    job = new SyncQueueCleanupJob(prisma as any, configService as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('purgeFinishedRows', () => {
    it('purges finished rows in bounded batches across every tenant and logs the total', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
        { id: 'sub-a' },
        { id: 'sub-b' },
      ]);
      // Tenant A holds 510 finished rows: one full batch of 500 forces a
      // second deleteMany pass for the remaining 10.
      queueBatch('sub-a', PURGE_BATCH_SIZE, 'q-a1');
      queueBatch('sub-a', 10, 'q-a2');
      queueBatch('sub-b', 3, 'q-b');

      await job.purgeFinishedRows();

      expect(prisma.syncQueue.deleteMany).toHaveBeenCalledTimes(3);
      const batchCalls = (prisma.syncQueue.deleteMany as jest.Mock).mock.calls;
      expect(batchCalls[0][0].where.id.in).toHaveLength(PURGE_BATCH_SIZE);
      expect(batchCalls[1][0].where.id.in).toHaveLength(10);
      expect(batchCalls[2][0].where.id.in).toHaveLength(3);
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('Purged 513'),
      );
    });

    it('wraps each tenant purge in withTenant using the subscription ids', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
        { id: 'sub-1' },
        { id: 'sub-2' },
      ]);

      await job.purgeFinishedRows();

      expect(prisma.withTenant).toHaveBeenCalledTimes(2);
      expect(prisma.withTenant).toHaveBeenNthCalledWith(
        1,
        'sub-1',
        expect.any(Function),
      );
      expect(prisma.withTenant).toHaveBeenNthCalledWith(
        2,
        'sub-2',
        expect.any(Function),
      );
    });

    it('deletes nothing and logs nothing when no tenant has finished rows', async () => {
      // The per-tenant findMany queue stays empty: the terminal-status and
      // cutoff filters match nothing.
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
        { id: 'sub-empty' },
      ]);

      await job.purgeFinishedRows();

      expect(prisma.syncQueue.deleteMany).not.toHaveBeenCalled();
      expect(loggerLog).not.toHaveBeenCalled();
    });

    it('computes the cutoff from SYNC_QUEUE_RETENTION_DAYS and filters terminal statuses only', async () => {
      configService.getOrThrow.mockReturnValue(7);
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
        { id: 'sub-a' },
      ]);

      await job.purgeFinishedRows();

      const expectedCutoff = new Date(FIXED_NOW - 7 * 86_400_000);
      expect(configService.getOrThrow).toHaveBeenCalledWith(
        'SYNC_QUEUE_RETENTION_DAYS',
      );
      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith({
        where: {
          status: {
            in: [
              SYNC_STATUS_VALUES.SyncStatus.COMPLETED,
              SYNC_STATUS_VALUES.SyncStatus.PERMANENT_FAILURE,
              SYNC_STATUS_VALUES.SyncStatus.DISCARDED,
            ],
          },
          OR: [
            { processedAt: { lt: expectedCutoff } },
            { processedAt: null, receivedAt: { lt: expectedCutoff } },
          ],
        },
        select: { id: true },
        take: PURGE_BATCH_SIZE,
      });
    });
  });
});
