// The job's import chain pulls in PrismaService, which value-imports the
// generated Prisma client — the real client must not load under jest.
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Logger } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { ResolutionExpirationAlertJob } from './resolution-expiration-alert.job';

const NOW = new Date('2026-08-03T00:00:00.000Z');
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe('ResolutionExpirationAlertJob', () => {
  let job: ResolutionExpirationAlertJob;
  let mockPrisma: DeepMockProxy<PrismaService>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    // PrismaService returns a tenant-aware proxy from its constructor, so the
    // job is handed the plain mocked instance directly, not via DI.
    mockPrisma = mockDeep<PrismaService>();
    mockPrisma.withTenant.mockImplementation(async (_subscriptionId, fn) =>
      fn(mockPrisma as never),
    );
    mockPrisma.fiscalResolution.updateMany.mockResolvedValue({ count: 0 });
    job = new ResolutionExpirationAlertJob(
      mockPrisma as unknown as PrismaService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('checkExpirations', () => {
    it('iterates every subscription returned by subscription.findMany', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1' },
        { id: 'sub-2' },
      ]);

      await job.checkExpirations();

      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith({
        select: { id: true },
      });
      expect(mockPrisma.withTenant).toHaveBeenCalledTimes(2);
    });

    it('runs each tenant work inside withTenant with that subscription id', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1' },
        { id: 'sub-2' },
      ]);

      await job.checkExpirations();

      expect(mockPrisma.withTenant).toHaveBeenNthCalledWith(
        1,
        'sub-1',
        expect.any(Function),
      );
      expect(mockPrisma.withTenant).toHaveBeenNthCalledWith(
        2,
        'sub-2',
        expect.any(Function),
      );
    });

    it('marks ACTIVE resolutions EXPIRING when validTo is within the 30-day threshold from now', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      mockPrisma.fiscalResolution.updateMany.mockResolvedValue({ count: 1 });

      await job.checkExpirations();

      expect(mockPrisma.fiscalResolution.updateMany).toHaveBeenCalledWith({
        where: {
          state: 'ACTIVE',
          validTo: { gte: NOW, lte: new Date(NOW.getTime() + THIRTY_DAYS_MS) },
        },
        data: { state: 'EXPIRING' },
      });
    });

    it('marks ACTIVE and EXPIRING resolutions EXPIRED once validTo has passed', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      mockPrisma.fiscalResolution.updateMany.mockResolvedValue({ count: 1 });

      await job.checkExpirations();

      expect(mockPrisma.fiscalResolution.updateMany).toHaveBeenCalledWith({
        where: { state: { in: ['ACTIVE', 'EXPIRING'] }, validTo: { lt: NOW } },
        data: { state: 'EXPIRED' },
      });
    });

    it('does not touch any resolution when no subscription exists', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      await job.checkExpirations();

      expect(mockPrisma.withTenant).not.toHaveBeenCalled();
      expect(mockPrisma.fiscalResolution.updateMany).not.toHaveBeenCalled();
    });

    it('skips logging when no resolution rows are updated', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      mockPrisma.fiscalResolution.updateMany.mockResolvedValue({ count: 0 });

      await job.checkExpirations();

      expect(Logger.prototype.log).not.toHaveBeenCalled();
    });
  });
});
