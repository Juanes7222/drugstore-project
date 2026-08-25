// The job's import chain pulls in PrismaService, which value-imports the
// generated Prisma client — the real client must not load under jest.
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Logger } from '@nestjs/common';
import { mockDeep, type DeepMockProxy } from 'jest-mock-extended';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { FiscalCertificateExpirationJob } from './fiscal-certificate-expiration.job';

const NOW = new Date('2026-08-21T12:00:00.000Z');

describe('FiscalCertificateExpirationJob', () => {
  let job: FiscalCertificateExpirationJob;
  let mockPrisma: DeepMockProxy<PrismaService>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    mockPrisma = mockDeep<PrismaService>();
    mockPrisma.withTenant.mockImplementation(async (_subscriptionId, fn) =>
      fn(mockPrisma as never),
    );
    mockPrisma.fiscalCertificate.updateMany.mockResolvedValue({ count: 0 });
    job = new FiscalCertificateExpirationJob(
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

    it('marks ACTIVE certificates EXPIRED once validTo has passed', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      mockPrisma.fiscalCertificate.updateMany.mockResolvedValue({ count: 2 });

      await job.checkExpirations();

      expect(mockPrisma.fiscalCertificate.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'ACTIVE',
          validTo: { lt: NOW },
        },
        data: { status: 'EXPIRED' },
      });
    });

    it('does not touch any certificate when no subscription exists', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      await job.checkExpirations();

      expect(mockPrisma.withTenant).not.toHaveBeenCalled();
      expect(mockPrisma.fiscalCertificate.updateMany).not.toHaveBeenCalled();
    });

    it('skips logging when no certificate rows are updated', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([{ id: 'sub-1' }]);
      mockPrisma.fiscalCertificate.updateMany.mockResolvedValue({ count: 0 });

      await job.checkExpirations();

      expect(Logger.prototype.log).not.toHaveBeenCalled();
    });
  });
});
