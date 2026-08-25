// Mock @pharmacy/database before any imports that depend on it
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { Prisma, PrismaClient } from '@pharmacy/database';
import { ReportsService } from './reports.service';

function validQuery(overrides: Record<string, unknown> = {}) {
  return {
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    view: 'fiscal' as const,
    ...overrides,
  };
}

interface QueryRawRoute {
  matches: (sql: string) => boolean;
  resolve: () => unknown;
}

/**
 * Routes $queryRaw tagged-template calls to canned rows by inspecting the
 * SQL text. Promise.all makes call order nondeterministic within a tick, so
 * matching on SQL content (not call index) is the only stable dispatch. An
 * unmatched SQL fails the test loudly instead of resolving wrong rows.
 */
function routeQueryRaw(
  prismaMock: DeepMockProxy<PrismaClient>,
  routes: QueryRawRoute[],
): void {
  (prismaMock.$queryRaw as jest.Mock).mockImplementation(
    (...args: unknown[]) => {
      const sql = (args[0] as TemplateStringsArray).join(' ');
      const route = routes.find((r) => r.matches(sql));
      if (!route) {
        throw new Error(`Unexpected $queryRaw call in test: ${sql}`);
      }
      return Promise.resolve(route.resolve());
    },
  );
}

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new ReportsService(prisma as any);
  });

  describe('getSalesSummary', () => {
    it('returns aggregated totals and per-saleType breakdown for the date range', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"saleType"'),
          resolve: () => [
            {
              saleType: 'PRESCRIPTION',
              count: 1,
              totalAmount: new Prisma.Decimal('5000.50'),
            },
            {
              saleType: 'FREE_SALE',
              count: 6,
              totalAmount: new Prisma.Decimal('5000'),
            },
          ],
        },
        {
          matches: (sql) => sql.includes('"totalSales"'),
          resolve: () => [
            { totalSales: new Prisma.Decimal('10000.50'), totalQuantity: 7 },
          ],
        },
      ]);

      const result = await service.getSalesSummary(validQuery());

      expect(result.totalSales).toBe('10000.50');
      expect(result.totalQuantity).toBe(7);
      expect(result.breakdownBySaleType).toEqual([
        {
          saleType: 'PRESCRIPTION',
          count: 1,
          totalAmount: '5000.50',
          averageAmount: '5000.50',
        },
        {
          saleType: 'FREE_SALE',
          count: 6,
          totalAmount: '5000.00',
          averageAmount: '833.33',
        },
      ]);
    });

    it('sends both aggregate queries with parsed Date bounds', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"saleType"'),
          resolve: () => [],
        },
        {
          matches: (sql) => sql.includes('"totalSales"'),
          resolve: () => [],
        },
      ]);

      await service.getSalesSummary(validQuery());

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      const calls = (prisma.$queryRaw as jest.Mock).mock.calls as unknown[][];
      for (const call of calls) {
        expect(call[1]).toEqual(new Date('2026-01-01'));
        expect(call[2]).toEqual(new Date('2026-01-31'));
      }
    });

    it('throws ReportInvalidDateRangeException when dateFrom > dateTo', async () => {
      await expect(service.getSalesSummary(validQuery({ dateFrom: '2026-02-01', dateTo: '2026-01-01' })))
        .rejects.toThrow(/date range is invalid/);
    });

    it('keeps breakdown rows with null saleType', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"saleType"'),
          resolve: () => [
            { saleType: null, count: 1, totalAmount: new Prisma.Decimal('5000') },
          ],
        },
        {
          matches: (sql) => sql.includes('"totalSales"'),
          resolve: () => [
            { totalSales: new Prisma.Decimal('5000'), totalQuantity: 1 },
          ],
        },
      ]);

      const result = await service.getSalesSummary(validQuery());

      expect(result.breakdownBySaleType[0].saleType).toBeNull();
      expect(result.breakdownBySaleType[0].averageAmount).toBe('5000.00');
    });

    it('falls back to zeroed totals and empty breakdown when both queries return no rows', async () => {
      routeQueryRaw(prisma, [
        { matches: (sql) => sql.includes('"saleType"'), resolve: () => [] },
        { matches: (sql) => sql.includes('"totalSales"'), resolve: () => [] },
      ]);

      const result = await service.getSalesSummary(validQuery());

      expect(result.totalQuantity).toBe(0);
      expect(result.totalSales).toBe('0.00');
      expect(result.breakdownBySaleType).toEqual([]);
    });

    it('returns zero average amount when a breakdown row has zero count', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"saleType"'),
          resolve: () => [
            { saleType: 'FREE_SALE', count: 0, totalAmount: new Prisma.Decimal('0') },
          ],
        },
        {
          matches: (sql) => sql.includes('"totalSales"'),
          resolve: () => [
            { totalSales: new Prisma.Decimal('0'), totalQuantity: 0 },
          ],
        },
      ]);

      const result = await service.getSalesSummary(validQuery());

      expect(result.breakdownBySaleType[0].averageAmount).toBe('0.00');
    });
  });

  describe('getCashShiftSummary', () => {
    it('returns shift totals and payment-category breakdown with averages', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"category"'),
          resolve: () => [
            { category: 'CASH', count: 4, totalAmount: new Prisma.Decimal('90000') },
            { category: 'CARD', count: 2, totalAmount: new Prisma.Decimal('35000') },
          ],
        },
        {
          matches: (sql) => sql.includes('"totalShifts"'),
          resolve: () => [
            { totalShifts: 3, totalCashMovement: new Prisma.Decimal('125000.75') },
          ],
        },
      ]);

      const result = await service.getCashShiftSummary(validQuery());

      expect(result.totalShifts).toBe(3);
      expect(result.totalCashMovement).toBe('125000.75');
      expect(result.breakdownByPaymentMethod).toEqual([
        {
          paymentMethodCategory: 'CASH',
          count: 4,
          totalAmount: '90000.00',
          averageAmount: '22500.00',
        },
        {
          paymentMethodCategory: 'CARD',
          count: 2,
          totalAmount: '35000.00',
          averageAmount: '17500.00',
        },
      ]);
    });

    it('returns zeroed totals when the shifts query returns no rows', async () => {
      routeQueryRaw(prisma, [
        { matches: (sql) => sql.includes('"category"'), resolve: () => [] },
        { matches: (sql) => sql.includes('"totalShifts"'), resolve: () => [] },
      ]);

      const result = await service.getCashShiftSummary(validQuery());

      expect(result.totalShifts).toBe(0);
      expect(result.totalCashMovement).toBe('0.00');
      expect(result.breakdownByPaymentMethod).toEqual([]);
    });

    it('maps null payment category rows to OTHER', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"category"'),
          resolve: () => [
            { category: null, count: 1, totalAmount: new Prisma.Decimal('10000') },
          ],
        },
        {
          matches: (sql) => sql.includes('"totalShifts"'),
          resolve: () => [
            { totalShifts: 1, totalCashMovement: new Prisma.Decimal('10000') },
          ],
        },
      ]);

      const result = await service.getCashShiftSummary(validQuery());

      expect(result.breakdownByPaymentMethod[0].paymentMethodCategory).toBe(
        'OTHER',
      );
      expect(result.breakdownByPaymentMethod[0].averageAmount).toBe('10000.00');
    });
  });

  describe('getInventoryValuation', () => {
    function valuationRow(overrides: Record<string, unknown> = {}) {
      return {
        productId: 'prod-a',
        productName: 'Product A',
        quantity: BigInt(15),
        totalValue: new Prisma.Decimal('75000'),
        activeLots: BigInt(2),
        expiringLots: BigInt(1),
        unknownCostLots: BigInt(0),
        ...overrides,
      };
    }

    it('values inventory per product from grouped lot rows', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"activeLots"'),
          resolve: () => [valuationRow()],
        },
      ]);

      const result = await service.getInventoryValuation(validQuery());

      expect(result.valuationDate).toBe(
        new Date('2026-01-01').toISOString(),
      );
      expect(result.totalLotsActive).toBe(2);
      expect(result.totalLotsExpiring).toBe(1);
      expect(result.lotsWithUnknownCost).toBe(0);
      expect(result.totalInventoryValue).toBe('75000.00');
      expect(result.breakdownByProduct).toEqual([
        {
          productId: 'prod-a',
          productName: 'Product A',
          quantity: 15,
          unitCost: '5000.00',
          totalValue: '75000.00',
          expiringLotCount: 1,
        },
      ]);
    });

    it('counts unknown-cost lots in lot counters but contributes zero to value', async () => {
      // Product B: every active lot has unknown cost (unknownCostLots === activeLots).
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"activeLots"'),
          resolve: () => [
            valuationRow(),
            valuationRow({
              productId: 'prod-b',
              productName: 'Product B',
              quantity: BigInt(4),
              totalValue: new Prisma.Decimal('0'),
              activeLots: BigInt(1),
              expiringLots: BigInt(0),
              unknownCostLots: BigInt(1),
            }),
          ],
        },
      ]);

      const result = await service.getInventoryValuation(validQuery());

      expect(result.totalLotsActive).toBe(3);
      expect(result.totalLotsExpiring).toBe(1);
      expect(result.lotsWithUnknownCost).toBe(1);
      expect(result.totalInventoryValue).toBe('75000.00');
      expect(result.breakdownByProduct[1]).toEqual({
        productId: 'prod-b',
        productName: 'Product B',
        quantity: 4,
        unitCost: '0.00',
        totalValue: '0.00',
        expiringLotCount: 0,
      });
    });

    it('returns zeroed valuation when no lots have current stock', async () => {
      routeQueryRaw(prisma, [
        { matches: (sql) => sql.includes('"activeLots"'), resolve: () => [] },
      ]);

      const result = await service.getInventoryValuation(validQuery());

      expect(result.totalLotsActive).toBe(0);
      expect(result.totalLotsExpiring).toBe(0);
      expect(result.lotsWithUnknownCost).toBe(0);
      expect(result.totalInventoryValue).toBe('0.00');
      expect(result.breakdownByProduct).toEqual([]);
    });
  });

  describe('getTaxSummary', () => {
    function taxRow(overrides: Record<string, unknown> = {}) {
      return {
        taxRate: new Prisma.Decimal('0.19'),
        taxableBase: new Prisma.Decimal('15000.00'),
        taxAmount: new Prisma.Decimal('2850.00'),
        documentCount: BigInt(3),
        totalDocuments: BigInt(5),
        ...overrides,
      };
    }

    it('counts documents without items via the NULL-rate row but excludes them from monetary buckets', async () => {
      // PostgreSQL ORDER BY "taxRate" ASC sorts NULL last; mirror that here.
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"taxRate"'),
          resolve: () => [
            taxRow({ taxRate: new Prisma.Decimal('0.05'), taxableBase: new Prisma.Decimal('2000.00'), taxAmount: new Prisma.Decimal('100.00'), documentCount: BigInt(2) }),
            taxRow(),
            taxRow({ taxRate: null, taxableBase: null, taxAmount: null, documentCount: BigInt(0) }),
          ],
        },
      ]);

      const result = await service.getTaxSummary(validQuery());

      expect(result.reportPeriod).toEqual({
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });
      expect(result.totalDocuments).toBe(5);
      expect(result.totalTaxableBase).toBe('17000.00');
      expect(result.totalTaxAmount).toBe('2950.00');
      expect(result.breakdownByTaxRate).toEqual([
        {
          taxRate: '0.0500',
          taxableBase: '2000.00',
          taxAmount: '100.00',
          documentCount: 2,
        },
        {
          taxRate: '0.1900',
          taxableBase: '15000.00',
          taxAmount: '2850.00',
          documentCount: 3,
        },
      ]);
    });

    it('returns zeroed monetary totals when only documents without items exist', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"taxRate"'),
          resolve: () => [
            taxRow({ taxRate: null, taxableBase: null, taxAmount: null, documentCount: BigInt(0), totalDocuments: BigInt(4) }),
          ],
        },
      ]);

      const result = await service.getTaxSummary(validQuery());

      expect(result.totalDocuments).toBe(4);
      expect(result.totalTaxableBase).toBe('0.00');
      expect(result.totalTaxAmount).toBe('0.00');
      expect(result.breakdownByTaxRate).toEqual([]);
    });

    it('returns zeroed report when the query returns no group rows at all', async () => {
      routeQueryRaw(prisma, [
        { matches: (sql) => sql.includes('"taxRate"'), resolve: () => [] },
      ]);

      const result = await service.getTaxSummary(validQuery());

      expect(result.totalDocuments).toBe(0);
      expect(result.breakdownByTaxRate).toEqual([]);
    });
  });

  describe('getFiscalReport', () => {
    function fiscalRow(overrides: Record<string, unknown> = {}) {
      return {
        documentType: 'INVOICE',
        fiscalState: 'VALIDATED',
        count: 5,
        subtotal: new Prisma.Decimal('50000'),
        totalTax: new Prisma.Decimal('9500'),
        totalAmount: new Prisma.Decimal('59500'),
        ...overrides,
      };
    }

    it('nests states by descending count inside alphabetically ordered types and sums totals across rows', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"fiscalState"'),
          resolve: () => [
            fiscalRow(),
            fiscalRow({ fiscalState: 'REJECTED', count: 1, subtotal: new Prisma.Decimal('8000'), totalTax: new Prisma.Decimal('0'), totalAmount: new Prisma.Decimal('8000') }),
            fiscalRow({ fiscalState: 'PENDING_GENERATION', count: 2, subtotal: new Prisma.Decimal('12000'), totalTax: new Prisma.Decimal('0'), totalAmount: new Prisma.Decimal('12000') }),
            fiscalRow({ documentType: 'CREDIT_NOTE', fiscalState: 'ACCEPTED', count: 1, subtotal: new Prisma.Decimal('2000'), totalTax: new Prisma.Decimal('0'), totalAmount: new Prisma.Decimal('2000') }),
            fiscalRow({ documentType: 'CREDIT_NOTE', fiscalState: 'VALIDATED', count: 3, subtotal: new Prisma.Decimal('6000'), totalTax: new Prisma.Decimal('300'), totalAmount: new Prisma.Decimal('6300') }),
          ],
        },
      ]);

      const result = await service.getFiscalReport(validQuery());

      expect(result.reportPeriod).toEqual({
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });
      expect(result.view).toBe('fiscal');
      expect(result.totalDocuments).toBe(12);
      expect(result.totalSubtotal).toBe('78000.00');
      expect(result.totalTax).toBe('9800.00');
      expect(result.totalAmount).toBe('87800.00');

      expect(result.breakdownByType.map((t: any) => t.documentType)).toEqual([
        'CREDIT_NOTE',
        'INVOICE',
      ]);
      expect(
        result.breakdownByType[1].states.map((s: any) => s.state),
      ).toEqual(['VALIDATED', 'PENDING_GENERATION', 'REJECTED']);
      expect(
        result.breakdownByType[1].states.map((s: any) => s.count),
      ).toEqual([5, 2, 1]);
      expect(result.breakdownByType[1].count).toBe(8);
      expect(result.breakdownByType[1].totalAmount.toFixed(2)).toBe(
        '79500.00',
      );
      expect(result.breakdownByType[0].states).toEqual([
        { state: 'VALIDATED', count: 3 },
        { state: 'ACCEPTED', count: 1 },
      ]);
    });

    it('returns zeroed totals and empty breakdown when no documents exist', async () => {
      routeQueryRaw(prisma, [
        { matches: (sql) => sql.includes('"fiscalState"'), resolve: () => [] },
      ]);

      const result = await service.getFiscalReport(validQuery());

      expect(result.totalDocuments).toBe(0);
      expect(result.totalSubtotal).toBe('0.00');
      expect(result.totalTax).toBe('0.00');
      expect(result.totalAmount).toBe('0.00');
      expect(result.breakdownByType).toEqual([]);
    });
  });

  describe('getDailyReport', () => {
    function dailyRow(overrides: Record<string, unknown> = {}) {
      return {
        day: '2026-01-01',
        salesCount: 2,
        totalAmount: new Prisma.Decimal('80000'),
        totalTax: new Prisma.Decimal('15200'),
        commissionAmount: new Prisma.Decimal('1600'),
        quantity: 4,
        ...overrides,
      };
    }

    it('computes per-day average tickets and roll-up totals across days', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"commissionAmount"'),
          resolve: () => [
            dailyRow(),
            dailyRow({
              day: '2026-01-02',
              salesCount: 1,
              totalAmount: new Prisma.Decimal('20000'),
              totalTax: new Prisma.Decimal('3800'),
              commissionAmount: new Prisma.Decimal('400'),
              quantity: 2,
            }),
          ],
        },
      ]);

      const result = await service.getDailyReport(validQuery());

      expect(result.reportPeriod).toEqual({
        dateFrom: '2026-01-01',
        dateTo: '2026-01-31',
      });
      expect(result.view).toBe('fiscal');
      expect(result.totalDays).toBe(2);
      expect(result.totals).toEqual({
        totalSales: 3,
        totalAmount: '100000.00',
        totalTax: '19000.00',
        totalQuantity: 6,
        averageTicket: '33333.33',
        totalCommission: '2000.00',
      });
      expect(result.dailyEntries).toEqual([
        {
          date: '2026-01-01',
          salesCount: 2,
          totalAmount: '80000.00',
          totalTax: '15200.00',
          quantity: 4,
          commissionAmount: '1600.00',
          averageTicket: '40000.00',
        },
        {
          date: '2026-01-02',
          salesCount: 1,
          totalAmount: '20000.00',
          totalTax: '3800.00',
          quantity: 2,
          commissionAmount: '400.00',
          averageTicket: '20000.00',
        },
      ]);
    });

    it('returns zeroed totals with zero average ticket when no sales exist', async () => {
      routeQueryRaw(prisma, [
        {
          matches: (sql) => sql.includes('"commissionAmount"'),
          resolve: () => [],
        },
      ]);

      const result = await service.getDailyReport(validQuery());

      expect(result.totalDays).toBe(0);
      expect(result.totals.totalSales).toBe(0);
      expect(result.totals.averageTicket).toBe('0.00');
      expect(result.dailyEntries).toEqual([]);
    });
  });
});
