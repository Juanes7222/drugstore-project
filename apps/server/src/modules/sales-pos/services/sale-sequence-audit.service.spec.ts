import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());


import { SaleSequenceAuditService } from './sale-sequence-audit.service';

/** groupBy row factory: localNumbers arrive as bigint, counts as number. */
function buildGroupRow(overrides?: {
  sourceWorkstationId?: string;
  count?: number;
  min?: bigint | null;
  max?: bigint | null;
}) {
  const count = overrides?.count ?? 0;
  return {
    sourceWorkstationId: overrides?.sourceWorkstationId ?? 'ws-1',
    _count: { localNumber: count },
    _min: { localNumber: overrides?.hasOwnProperty('min') ? overrides.min : BigInt(1) },
    _max: { localNumber: overrides?.hasOwnProperty('max') ? overrides.max : BigInt(1) },
  };
}

function buildSale(sourceWorkstationId: string, localNumber: bigint) {
  return { sourceWorkstationId, localNumber };
}

describe('SaleSequenceAuditService', () => {
  let service: SaleSequenceAuditService;
  let prisma: DeepMockProxy<PrismaClient>;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new SaleSequenceAuditService(prisma as any);
    warnSpy = jest
      .spyOn(service['logger'], 'warn')
      .mockImplementation(() => undefined);
  });

  describe('getSummaries', () => {
    it('reports zero holes for a contiguous per-workstation sequence', async () => {
      (prisma.sale.groupBy as jest.Mock).mockResolvedValue([
        buildGroupRow({ sourceWorkstationId: 'ws-1', count: 5, min: 1n, max: 5n }),
      ]);

      const result = await service.getSummaries();

      expect(prisma.sale.groupBy).toHaveBeenCalledWith({
        by: ['sourceWorkstationId'],
        _count: { localNumber: true },
        _min: { localNumber: true },
        _max: { localNumber: true },
      });
      expect(result).toEqual([
        {
          sourceWorkstationId: 'ws-1',
          minLocalNumber: '1',
          maxLocalNumber: '5',
          saleCount: 5,
          holeCount: 0,
        },
      ]);
    });

    it('counts interior holes as (max - min + 1) - saleCount', async () => {
      // Numbers 1..6 with only 4 sales: two numbers have no row.
      (prisma.sale.groupBy as jest.Mock).mockResolvedValue([
        buildGroupRow({ sourceWorkstationId: 'ws-1', count: 4, min: 1n, max: 6n }),
      ]);

      const result = await service.getSummaries();

      expect(result[0].holeCount).toBe(2);
    });

    it('summarizes each workstation independently', async () => {
      (prisma.sale.groupBy as jest.Mock).mockResolvedValue([
        buildGroupRow({ sourceWorkstationId: 'ws-1', count: 3, min: 1n, max: 3n }),
        buildGroupRow({ sourceWorkstationId: 'ws-2', count: 2, min: 10n, max: 20n }),
      ]);

      const result = await service.getSummaries();

      expect(result.map((row) => row.holeCount)).toEqual([0, 9]);
      expect(result.map((row) => row.sourceWorkstationId)).toEqual(['ws-1', 'ws-2']);
    });

    it('falls back to 0n when a group has null min and max', async () => {
      // Defensive branch: a real Prisma groupBy never emits an empty group,
      // but the fallback must not crash on synthetic rows.
      (prisma.sale.groupBy as jest.Mock).mockResolvedValue([
        buildGroupRow({ sourceWorkstationId: 'ws-empty', count: 0, min: null, max: null }),
      ]);

      const result = await service.getSummaries();

      expect(result[0].minLocalNumber).toBe('0');
      expect(result[0].maxLocalNumber).toBe('0');
      expect(result[0].saleCount).toBe(0);
    });
  });

  describe('findGaps', () => {
    it('returns no gaps for a contiguous sequence starting at 1', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        buildSale('ws-1', 1n),
        buildSale('ws-1', 2n),
        buildSale('ws-1', 3n),
      ]);

      const result = await service.findGaps();

      expect(prisma.sale.findMany).toHaveBeenCalledWith({
        where: {},
        select: { sourceWorkstationId: true, localNumber: true },
        orderBy: [{ sourceWorkstationId: 'asc' }, { localNumber: 'asc' }],
      });
      expect(result).toEqual([]);
    });

    it('reports the exact missing numbers for a hole in the middle', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        buildSale('ws-1', 1n),
        buildSale('ws-1', 2n),
        buildSale('ws-1', 4n),
      ]);

      const result = await service.findGaps();

      expect(result).toEqual([{ sourceWorkstationId: 'ws-1', localNumber: '3' }]);
    });

    it('reports 1..min-1 when numbering starts above 1', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        buildSale('ws-1', 3n),
        buildSale('ws-1', 4n),
      ]);

      const result = await service.findGaps();

      expect(result).toEqual([
        { sourceWorkstationId: 'ws-1', localNumber: '1' },
        { sourceWorkstationId: 'ws-1', localNumber: '2' },
      ]);
    });

    it('tracks each workstation expectation independently', async () => {
      // Ordered by workstationId then localNumber, so sequences never
      // interleave; ws-b legitimately starts at 2.
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        buildSale('ws-a', 1n),
        buildSale('ws-a', 3n),
        buildSale('ws-b', 2n),
        buildSale('ws-b', 4n),
      ]);

      const result = await service.findGaps();

      expect(result).toEqual([
        { sourceWorkstationId: 'ws-a', localNumber: '2' },
        { sourceWorkstationId: 'ws-b', localNumber: '1' },
        { sourceWorkstationId: 'ws-b', localNumber: '3' },
      ]);
    });

    it('never lowers the next expected number for values below the current watermark', async () => {
      // Non-decreasing stream with a duplicate: the repeated 2 must neither
      // create a phantom gap nor reset the expectation below 3.
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        buildSale('ws-1', 2n),
        buildSale('ws-1', 2n),
        buildSale('ws-1', 3n),
      ]);

      const result = await service.findGaps();

      expect(result).toEqual([{ sourceWorkstationId: 'ws-1', localNumber: '1' }]);
    });

    it('filters by workstation when one is given', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([]);

      await service.findGaps('ws-7');

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sourceWorkstationId: 'ws-7' } }),
      );
    });

    it('truncates reported gaps at 200 entries and logs the truncation', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        buildSale('ws-1', 500n),
      ]);

      const result = await service.findGaps();

      expect(result).toHaveLength(200);
      expect(result[0].localNumber).toBe('1');
      expect(result[199].localNumber).toBe('200');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('truncated at 200'),
      );
    });

    it('does not log truncation when gaps stay under the cap', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        buildSale('ws-1', 150n),
      ]);

      const result = await service.findGaps();

      expect(result).toHaveLength(149);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
