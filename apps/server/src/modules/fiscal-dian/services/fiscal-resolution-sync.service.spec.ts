import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { FiscalResolutionSyncService } from './fiscal-resolution-sync.service';
import { FiscalIssuerConfigNotSetException } from '../exceptions/fiscal-issuer-config-not-set.exception';
import { FiscalActiveCertificateMissingException } from '../exceptions/fiscal-active-certificate-missing.exception';
import { DianSyncJobNotFoundException } from '../exceptions/dian-sync-job-not-found.exception';
import { AllocationRangeInvalidException } from '../exceptions/allocation-range-invalid.exception';

describe('FiscalResolutionSyncService', () => {
  let service: FiscalResolutionSyncService;

  const prisma = {
    fiscalIssuerConfig: { findFirst: jest.fn() },
    fiscalCertificate: { findFirst: jest.fn() },
  };

  const queue = {
    add: jest.fn().mockResolvedValue({ id: undefined }),
    getJob: jest.fn(),
  };

  const tenantContext = {
    getSubscriptionId: jest.fn(() => 'sub-1'),
    hasTenant: jest.fn(() => false),
    registerAfterCommit: jest.fn(),
  };

  const resolutionsService = { applyDianRanges: jest.fn() };
  const allocationsService = { create: jest.fn() };

  const buildService = () =>
    new FiscalResolutionSyncService(
      prisma as any,
      tenantContext as any,
      queue as any,
      resolutionsService as any,
      allocationsService as any,
    );

  const job = (overrides: Record<string, unknown> = {}) => ({
    id: 'job-1',
    getState: jest.fn().mockResolvedValue('completed'),
    returnvalue: { ok: true, ranges: [] },
    failedReason: null as string | null,
    data: {
      subscriptionId: 'sub-1',
      requestedByUserId: 'user-1',
      workstationId: null,
      ...(overrides.data ?? {}),
    },
    ...(overrides as any),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tenantContext.hasTenant.mockReturnValue(false);
    service = buildService();
  });

  // ── startSync ────────────────────────────────────────────────────────

  describe('startSync', () => {
    it('throws FiscalIssuerConfigNotSetException when no issuer config exists', async () => {
      prisma.fiscalIssuerConfig.findFirst.mockResolvedValue(null);

      await expect(
        service.startSync({ workstationId: null }, 'user-1'),
      ).rejects.toThrow(FiscalIssuerConfigNotSetException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('throws FiscalActiveCertificateMissingException without an ACTIVE certificate', async () => {
      prisma.fiscalIssuerConfig.findFirst.mockResolvedValue({ nit: '900123456' });
      prisma.fiscalCertificate.findFirst.mockResolvedValue(null);

      await expect(
        service.startSync({ workstationId: null }, 'user-1'),
      ).rejects.toThrow(FiscalActiveCertificateMissingException);
      expect(queue.add).not.toHaveBeenCalled();
    });

    it('enqueues directly with the pre-generated jobId outside a tenant context', async () => {
      prisma.fiscalIssuerConfig.findFirst.mockResolvedValue({ nit: '900123456' });
      prisma.fiscalCertificate.findFirst.mockResolvedValue({ id: 'cert-1' });
      queue.add.mockResolvedValue({ id: 'whatever' });

      const result = await service.startSync({ workstationId: null }, 'user-1');

      expect(queue.add).toHaveBeenCalledTimes(1);
      const [jobName, data, options] = queue.add.mock.calls[0];
      expect(jobName).toBe('fetch-numbering-ranges');
      expect(data).toEqual({
        subscriptionId: 'sub-1',
        requestedByUserId: 'user-1',
        workstationId: null,
      });
      // The response carries the same custom id BullMQ was given, so polling
      // works even though the add happens after commit.
      expect(options.jobId).toBe(result.syncJobId);
    });

    it('registers enqueue via registerAfterCommit inside a tenant context', async () => {
      prisma.fiscalIssuerConfig.findFirst.mockResolvedValue({ nit: '900123456' });
      prisma.fiscalCertificate.findFirst.mockResolvedValue({ id: 'cert-1' });
      tenantContext.hasTenant.mockReturnValue(true);

      const result = await service.startSync(
        { workstationId: 'ws-1' },
        'user-1',
      );

      expect(queue.add).not.toHaveBeenCalled();
      expect(tenantContext.registerAfterCommit).toHaveBeenCalledTimes(1);

      // Simulate commit draining the callback.
      const callback = tenantContext.registerAfterCommit.mock.calls[0][0];
      await callback();
      expect(queue.add).toHaveBeenCalledTimes(1);
      const [, data] = queue.add.mock.calls[0];
      expect(data.workstationId).toBe('ws-1');
      expect(result.syncJobId).toBeDefined();
    });
  });

  // ── getSyncStatus ────────────────────────────────────────────────────

  describe('getSyncStatus', () => {
    it('throws DianSyncJobNotFoundException for an unknown job id', async () => {
      queue.getJob.mockResolvedValue(undefined);

      await expect(service.getSyncStatus('nope')).rejects.toThrow(
        DianSyncJobNotFoundException,
      );
    });

    it.each(['waiting', 'delayed', 'active'])(
      'returns PENDING while the job is %s',
      async (state) => {
        const pendingJob = job();
        pendingJob.getState.mockResolvedValue(state);
        queue.getJob.mockResolvedValue(pendingJob);

        await expect(service.getSyncStatus('job-1')).resolves.toEqual({
          status: 'PENDING',
        });
      },
    );

    it('maps a worker crash to FAILED/DIAN_UNAVAILABLE', async () => {
      const failedJob = job({
        failedReason: 'connect ETIMEDOUT',
        returnvalue: undefined,
      });
      failedJob.getState.mockResolvedValue('failed');
      queue.getJob.mockResolvedValue(failedJob);

      await expect(service.getSyncStatus('job-1')).resolves.toEqual({
        status: 'FAILED',
        errorCode: 'DIAN_UNAVAILABLE',
        message: 'connect ETIMEDOUT',
      });
      expect(resolutionsService.applyDianRanges).not.toHaveBeenCalled();
    });

    it('returns FAILED with the worker structured errorCode', async () => {
      queue.getJob.mockResolvedValue(
        job({
          returnvalue: {
            ok: false,
            errorCode: 'NOT_HABILITATED',
            message: 'DIAN GetNumberingRange failed with OperationCode 301',
          },
        }),
      );

      await expect(service.getSyncStatus('job-1')).resolves.toEqual({
        status: 'FAILED',
        errorCode: 'NOT_HABILITATED',
        message: 'DIAN GetNumberingRange failed with OperationCode 301',
      });
      expect(resolutionsService.applyDianRanges).not.toHaveBeenCalled();
    });

    it('applies ranges and reports APPLIED on success without a workstation', async () => {
      const appliedResult = { created: [], skipped: [], conflicts: [] };
      resolutionsService.applyDianRanges.mockResolvedValue(appliedResult);
      queue.getJob.mockResolvedValue(
        job({
          returnvalue: { ok: true, ranges: [{ prefix: 'F002' }] },
          data: { subscriptionId: 'sub-1', requestedByUserId: 'user-1', workstationId: null },
        }),
      );

      await expect(service.getSyncStatus('job-1')).resolves.toEqual({
        status: 'APPLIED',
        created: [],
        skipped: [],
        allocationsCreated: 0,
        allocationWarnings: [],
      });
      expect(resolutionsService.applyDianRanges).toHaveBeenCalledWith([
        { prefix: 'F002' },
      ]);
      expect(allocationsService.create).not.toHaveBeenCalled();
    });

    it('creates one full-range allocation per created resolution when workstationId set', async () => {
      resolutionsService.applyDianRanges.mockResolvedValue({
        created: [
          {
            resolutionId: 'res-1',
            resolutionNumber: '9310000085419',
            prefix: 'F002',
            documentType: 'INVOICE',
            rangeFrom: 1,
            rangeTo: 99999999,
          },
        ],
        skipped: [],
        conflicts: [],
      });
      allocationsService.create.mockResolvedValue({});
      queue.getJob.mockResolvedValue(
        job({
          data: { subscriptionId: 'sub-1', requestedByUserId: 'user-1', workstationId: 'ws-1' },
        }),
      );

      const status = await service.getSyncStatus('job-1');

      expect(status.allocationsCreated).toBe(1);
      expect(allocationsService.create).toHaveBeenCalledWith(
        {
          resolutionId: 'res-1',
          workstationId: 'ws-1',
          rangeFrom: 1,
          rangeTo: 99999999,
        },
        'user-1',
      );
    });

    it('degrades an invalid allocation to a warning instead of failing the sync', async () => {
      resolutionsService.applyDianRanges.mockResolvedValue({
        created: [
          {
            resolutionId: 'res-1',
            resolutionNumber: '9310000085419',
            prefix: 'F002',
            documentType: 'INVOICE',
            rangeFrom: 1,
            rangeTo: 100,
          },
        ],
        skipped: [],
        conflicts: [],
      });
      allocationsService.create.mockRejectedValue(
        new AllocationRangeInvalidException('overlaps'),
      );
      queue.getJob.mockResolvedValue(
        job({
          data: { subscriptionId: 'sub-1', requestedByUserId: 'user-1', workstationId: 'ws-1' },
        }),
      );

      const status = await service.getSyncStatus('job-1');

      expect(status.status).toBe('APPLIED');
      expect(status.allocationsCreated).toBe(0);
      expect(status.allocationWarnings).toHaveLength(1);
    });
  });
});
