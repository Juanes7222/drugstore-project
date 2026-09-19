import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Logger } from '@nestjs/common';
import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { SyncHousekeepingJob } from './sync-housekeeping.job';

describe('SyncHousekeepingJob', () => {
  let job: SyncHousekeepingJob;
  let prisma: DeepMockProxy<PrismaClient>;
  let configService: { getOrThrow: jest.Mock };
  let syncEventService: { deleteExpired: jest.Mock };
  let heartbeatService: { deleteOld: jest.Mock };
  let loggerLog: jest.SpyInstance;

  /** Tenants whose event purge ran inside withTenant, in call order. */
  let purgedTenants: string[];

  beforeEach(() => {
    loggerLog = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});

    prisma = mockDeep<PrismaClient>();
    (prisma.withTenant as jest.Mock).mockImplementation(
      async (subscriptionId: string, fn: () => Promise<number>) => {
        purgedTenants.push(subscriptionId);
        return fn();
      },
    );

    syncEventService = { deleteExpired: jest.fn().mockResolvedValue(0) };
    heartbeatService = { deleteOld: jest.fn().mockResolvedValue(0) };
    configService = { getOrThrow: jest.fn().mockReturnValue(72) };

    purgedTenants = [];

    job = new SyncHousekeepingJob(
      prisma as unknown as never,
      configService as unknown as never,
      syncEventService as unknown as never,
      heartbeatService as unknown as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('purgeExpiredRows', () => {
    it('purges events tenant by tenant inside withTenant and heartbeats in one global pass', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
        { id: 'sub-a' },
        { id: 'sub-b' },
      ]);
      syncEventService.deleteExpired
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(3);
      heartbeatService.deleteOld.mockResolvedValue(7);

      await job.purgeExpiredRows();

      // SyncEvent is RLS-scoped: a purge with no tenant bound matches zero rows
      // and still reports success, so the per-tenant iteration is the contract.
      expect(purgedTenants).toEqual(['sub-a', 'sub-b']);
      expect(syncEventService.deleteExpired).toHaveBeenCalledTimes(2);
      // WorkstationHeartbeat has no subscriptionId: a single global pass.
      expect(heartbeatService.deleteOld).toHaveBeenCalledTimes(1);
      expect(heartbeatService.deleteOld).toHaveBeenCalledWith(72);
      expect(loggerLog).toHaveBeenCalledWith(
        expect.stringContaining('deleted 5 expired sync event(s) and 7 heartbeat(s)'),
      );
    });

    it('still prunes heartbeats when there are no subscriptions', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([]);
      heartbeatService.deleteOld.mockResolvedValue(4);

      await job.purgeExpiredRows();

      expect(syncEventService.deleteExpired).not.toHaveBeenCalled();
      expect(heartbeatService.deleteOld).toHaveBeenCalledWith(72);
    });

    it('reads the heartbeat retention window from configuration', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([]);
      configService.getOrThrow.mockReturnValue(24);

      await job.purgeExpiredRows();

      expect(configService.getOrThrow).toHaveBeenCalledWith(
        'HEARTBEAT_RETENTION_HOURS',
      );
      expect(heartbeatService.deleteOld).toHaveBeenCalledWith(24);
    });

    it('stays quiet when there is nothing to delete', async () => {
      (prisma.subscription.findMany as jest.Mock).mockResolvedValue([
        { id: 'sub-a' },
      ]);

      await job.purgeExpiredRows();

      expect(loggerLog).not.toHaveBeenCalled();
    });
  });
});
