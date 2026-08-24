import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SyncIntegrityService } from './sync-integrity.service';
import type {
  WorkstationSequenceSummary,
  SequenceGap,
} from '@/modules/sales-pos/services/sale-sequence-audit.service';
import type { LedgerVerifyRequestDto } from '../dto/ledger-verify.dto';

function buildSummary(overrides?: Partial<WorkstationSequenceSummary>): WorkstationSequenceSummary {
  return {
    sourceWorkstationId: 'ws-1',
    minLocalNumber: '1',
    maxLocalNumber: '5',
    saleCount: 5,
    holeCount: 0,
    ...overrides,
  };
}

const NO_GAPS: SequenceGap[] = [];

function buildLedgerRequest(
  operations: Array<{ operationUuid: string; status: string }>,
): LedgerVerifyRequestDto {
  return {
    workstationId: 'ws-1',
    operations: operations as LedgerVerifyRequestDto['operations'],
  };
}

describe('SyncIntegrityService', () => {
  let service: SyncIntegrityService;
  let prisma: DeepMockProxy<PrismaClient>;
  let sequenceAudit: { getSummaries: jest.Mock; findGaps: jest.Mock };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    sequenceAudit = {
      getSummaries: jest.fn().mockResolvedValue([]),
      findGaps: jest.fn().mockResolvedValue(NO_GAPS),
    };
    service = new SyncIntegrityService(prisma as any, sequenceAudit as any);
  });

  describe('verifyLedger', () => {
    it('verdicts OK when the client reports SYNCED and the server completed', async () => {
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([
        { operationUuid: 'op-1', status: 'COMPLETED' },
      ]);

      const response = await service.verifyLedger(
        buildLedgerRequest([{ operationUuid: 'op-1', status: 'SYNCED' }]),
      );

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith({
        where: { operationUuid: { in: ['op-1'] } },
        select: { operationUuid: true, status: true },
      });
      expect(response.results).toEqual([
        {
          operationUuid: 'op-1',
          verdict: 'OK',
          clientStatus: 'SYNCED',
          serverStatus: 'COMPLETED',
        },
      ]);
      expect(response.checkedAt).toBeInstanceOf(Date);
    });

    it('verdicts NOT_SUBMITTED for a uuid unknown to the server', async () => {
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([]);

      const response = await service.verifyLedger(
        buildLedgerRequest([{ operationUuid: 'ghost-op', status: 'PENDING' }]),
      );

      expect(response.results[0]).toMatchObject({
        operationUuid: 'ghost-op',
        verdict: 'NOT_SUBMITTED',
        clientStatus: 'PENDING',
        serverStatus: null,
      });
    });

    it('verdicts NOT_ACCEPTED when a locally-synced operation is not completed server-side', async () => {
      // Worst case: POS UI claims success while the movement is not durable.
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([
        { operationUuid: 'op-2', status: 'FAILED' },
      ]);

      const response = await service.verifyLedger(
        buildLedgerRequest([{ operationUuid: 'op-2', status: 'SYNCED' }]),
      );

      expect(response.results[0].verdict).toBe('NOT_ACCEPTED');
    });

    it('verdicts STATUS_MISMATCH for a locally-discarded operation the server knows', async () => {
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([
        { operationUuid: 'op-3', status: 'COMPLETED' },
      ]);

      const response = await service.verifyLedger(
        buildLedgerRequest([{ operationUuid: 'op-3', status: 'DISCARDED' }]),
      );

      expect(response.results[0].verdict).toBe('STATUS_MISMATCH');
    });

    it('verdicts STATUS_MISMATCH for any other state disagreement', async () => {
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([
        { operationUuid: 'op-4', status: 'FAILED' },
      ]);

      const response = await service.verifyLedger(
        buildLedgerRequest([{ operationUuid: 'op-4', status: 'FAILED' }]),
      );

      expect(response.results[0].verdict).toBe('STATUS_MISMATCH');
    });

    it('counts one summary entry per verdict across a mixed batch', async () => {
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([
        { operationUuid: 'op-ok', status: 'COMPLETED' },
        { operationUuid: 'op-stuck', status: 'PROCESSING' },
        { operationUuid: 'op-discarded', status: 'COMPLETED' },
      ]);

      const response = await service.verifyLedger(
        buildLedgerRequest([
          { operationUuid: 'op-ok', status: 'SYNCED' },
          { operationUuid: 'unknown-op', status: 'SYNCED' },
          { operationUuid: 'op-stuck', status: 'SYNCED' },
          { operationUuid: 'op-discarded', status: 'DISCARDED' },
        ]),
      );

      expect(response.summary).toEqual({
        OK: 1,
        NOT_SUBMITTED: 1,
        NOT_ACCEPTED: 1,
        STATUS_MISMATCH: 1,
      });
      expect(response.results).toHaveLength(4);
    });
  });

  describe('getReport', () => {
    function arrangeQueueReport() {
      (prisma.syncQueue.groupBy as jest.Mock).mockResolvedValue([
        { status: 'COMPLETED', _count: { _all: 7 } },
        { status: 'FAILED', _count: { _all: 2 } },
      ]);
      (prisma.syncQueue.findMany as jest.Mock).mockResolvedValue([
        {
          operationUuid: 'op-fail-1',
          operationType: 'SALE',
          status: 'FAILED',
          retryCount: 3,
          lastErrorMessage: 'boom',
          receivedAt: new Date('2026-01-01T00:00:00Z'),
        },
      ]);
    }

    it('maps queue counts and passes problem entries through when holes exist', async () => {
      arrangeQueueReport();
      const gaps: SequenceGap[] = [
        { sourceWorkstationId: 'ws-1', localNumber: '4' },
      ];
      sequenceAudit.getSummaries.mockResolvedValue([
        buildSummary({ holeCount: 2 }),
      ]);
      sequenceAudit.findGaps.mockResolvedValue(gaps);

      const report = await service.getReport();

      expect(report.queueByStatus).toEqual({ COMPLETED: 7, FAILED: 2 });
      expect(report.problems).toHaveLength(1);
      expect(report.problems[0]).toMatchObject({
        operationUuid: 'op-fail-1',
        status: 'FAILED',
        lastErrorMessage: 'boom',
      });
      expect(report.sequenceSummaries).toHaveLength(1);
      // No explicit workstation requested — the scan runs because a
      // summary reported holes.
      expect(sequenceAudit.findGaps).toHaveBeenCalledWith(undefined);
      expect(report.sequenceGaps).toEqual(gaps);
      expect(report.generatedAt).toBeInstanceOf(Date);
    });

    it('skips the gap scan when no workstation is given and summaries are clean', async () => {
      arrangeQueueReport();
      sequenceAudit.getSummaries.mockResolvedValue([
        buildSummary({ holeCount: 0 }),
      ]);

      const report = await service.getReport();

      expect(sequenceAudit.findGaps).not.toHaveBeenCalled();
      expect(report.sequenceGaps).toEqual([]);
    });

    it('runs the gap scan for the requested workstation even when summaries are clean', async () => {
      arrangeQueueReport();
      sequenceAudit.getSummaries.mockResolvedValue([
        buildSummary({ sourceWorkstationId: 'ws-9', holeCount: 0 }),
      ]);

      await service.getReport('ws-9');

      expect(sequenceAudit.findGaps).toHaveBeenCalledWith('ws-9');
    });

    it('caps problem entries at 50 with the failure filter and recency order', async () => {
      arrangeQueueReport();
      sequenceAudit.getSummaries.mockResolvedValue([]);

      await service.getReport();

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith({
        where: { status: { in: ['FAILED', 'PERMANENT_FAILURE'] } },
        select: {
          operationUuid: true,
          operationType: true,
          status: true,
          retryCount: true,
          lastErrorMessage: true,
          receivedAt: true,
        },
        orderBy: { receivedAt: 'desc' },
        take: 50,
      });
    });
  });
});
