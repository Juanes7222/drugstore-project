import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SaasAdminCustomerService } from './saas-admin-customer.service';

const { Prisma } = jest.requireMock('@pharmacy/database');
function FakeDecimal(value: number) {
  return new Prisma.Decimal(value);
}

function formatLocalDate(day: Date): string {
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const dayOfMonth = String(day.getDate()).padStart(2, '0');
  return `${day.getFullYear()}-${month}-${dayOfMonth}`;
}

/** Local midnight N calendar days before today; negative = future days. */
function localMidnight(daysAgo: number): Date {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  day.setDate(day.getDate() - daysAgo);
  return day;
}

const ACTOR = { id: 'admin-1', role: 'SAAS_ADMIN' };
const SUBSCRIPTION_ID = 'sub-1';

describe('SaasAdminCustomerService', () => {
  let prisma: MockProxy<PrismaClient>;
  let accessAudit: { recordCustomerAccess: jest.Mock };
  let service: SaasAdminCustomerService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    // withTenant executes the callback with the mock itself (no real tenant transaction).
    (prisma.withTenant as jest.Mock).mockImplementation(
      async (_subscriptionId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
    );
    accessAudit = {
      recordCustomerAccess: jest.fn<(input: unknown) => Promise<void>>(),
    };
    accessAudit.recordCustomerAccess.mockResolvedValue(undefined);

    // Unused by getDashboard; required only by the constructor.
    service = new SaasAdminCustomerService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      accessAudit as never,
    );

    // Promise.all order in collectDashboard:
    // salesToday, sales30d, previousSales30d aggregates, then trend findMany.
    prisma.sale.aggregate
      .mockResolvedValueOnce({
        _count: { id: 2 },
        _sum: { totalAmount: new FakeDecimal(150) },
      })
      .mockResolvedValueOnce({
        _count: { id: 40 },
        _sum: { totalAmount: new FakeDecimal(900.5) },
      })
      .mockResolvedValueOnce({
        _count: { id: 12 },
        _sum: { totalAmount: new FakeDecimal(300) },
      });
    prisma.sale.findMany.mockResolvedValue([]);
    prisma.cashShift.count.mockResolvedValue(1);
    prisma.cashShift.aggregate.mockResolvedValue({
      _count: { id: 3 },
      _sum: { closingDifference: new FakeDecimal(-4.5) },
    });
    prisma.user.count.mockResolvedValue(2);
    prisma.fiscalDocument.groupBy.mockResolvedValue([]);
  });

  describe('getDashboard salesTrend', () => {
    it('runs every tenant query inside the subscription RLS-scoped transaction', async () => {
      await service.getDashboard(ACTOR, SUBSCRIPTION_ID);

      expect(prisma.withTenant).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        expect.any(Function),
      );
    });

    it('fetches trend sales over the trailing 30-day window of confirmed sales only', async () => {
      await service.getDashboard(ACTOR, SUBSCRIPTION_ID);

      expect(prisma.sale.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.sale.findMany).toHaveBeenCalledWith({
        where: {
          cashShift: { subscriptionId: SUBSCRIPTION_ID },
          // Exclusive upper bound keeps future-dated confirmed sales out of
          // the buckets, matching the sales30d aggregate below.
          confirmedAt: { gte: localMidnight(30), lt: localMidnight(-1) },
          operationalState: 'CONFIRMED',
        },
        select: { confirmedAt: true, totalAmount: true },
      });
    });

    it('excludes out-of-window FUTURE confirmed sales from both sales30d and trend', async () => {
      const futureSaleTime = new Date();
      futureSaleTime.setDate(futureSaleTime.getDate() + 2);
      futureSaleTime.setHours(12, 0, 0, 0);

      await service.getDashboard(ACTOR, SUBSCRIPTION_ID);

      // Second aggregate call is sales30d (order: salesToday, sales30d,
      // previousSales30d); it must carry the same exclusive upper bound as
      // the trend fetch or sum(days) could diverge from totalAmount.
      expect(prisma.sale.aggregate).toHaveBeenNthCalledWith(2, {
        where: {
          cashShift: { subscriptionId: SUBSCRIPTION_ID },
          confirmedAt: { gte: localMidnight(30), lt: localMidnight(-1) },
          operationalState: 'CONFIRMED',
        },
        _count: { id: true },
        _sum: { totalAmount: true },
      });
      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            confirmedAt: { gte: localMidnight(30), lt: localMidnight(-1) },
          }),
        }),
      );

      // A future-dated row that still reaches bucketing must land nowhere.
      // beforeEach's Once-chain is spent by the call above, so give every
      // aggregate a steady window-bounded sales30d answer for this round.
      prisma.sale.aggregate.mockReset();
      prisma.sale.aggregate.mockResolvedValue({
        _count: { id: 40 },
        _sum: { totalAmount: new FakeDecimal(900.5) },
      });
      prisma.sale.findMany.mockClear();
      prisma.sale.findMany.mockResolvedValue([
        { confirmedAt: futureSaleTime, totalAmount: new FakeDecimal(5000) },
      ] as never);
      const result = await service.getDashboard(ACTOR, SUBSCRIPTION_ID);

      expect(result.salesTrend.days.every((day) => day.count === 0)).toBe(true);
      // The service never sums rows itself for sales30d — it reports the
      // window-bounded aggregate, so a future sale cannot inflate either side.
      expect(result.sales30d.totalAmount).toBe('900.5');
      // Both windows must cover exactly the same rows: identical bounds on
      // the sales30d aggregate (asserted above via toHaveBeenNthCalledWith)
      // and this trend fetch.
      const lastFindManyCall = (
        prisma.sale.findMany as jest.Mock
      ).mock.calls.at(-1)! as [{ where: { confirmedAt: unknown } }];
      expect(lastFindManyCall[0].where.confirmedAt).toEqual({
        gte: localMidnight(30),
        lt: localMidnight(-1),
      });
    });

    it('returns 31 zero-filled ascending local days ending today when no sales exist', async () => {
      const result = await service.getDashboard(ACTOR, SUBSCRIPTION_ID);
      const days = result.salesTrend.days;

      // The trailing window [todayStart-30d .. todayStart] crosses 31 local
      // dates; emitting all keeps sum(days.totalAmount) == sales30d total.
      expect(days).toHaveLength(31);
      expect(days[0]?.date).toBe(formatLocalDate(localMidnight(30)));
      expect(days[30]?.date).toBe(formatLocalDate(new Date()));
      for (let i = 1; i < days.length; i += 1) {
        expect(days[i]!.date > days[i - 1]!.date).toBe(true);
      }
      days.forEach((day) => {
        expect(day.count).toBe(0);
        expect(day.totalAmount).toBe('0');
      });
    });

    it('buckets sales by local calendar day with decimal-string totals', async () => {
      const todaySaleTime = new Date();
      todaySaleTime.setHours(10, 30, 0, 0);
      const yesterdaySaleTime = new Date(todaySaleTime);
      yesterdaySaleTime.setDate(yesterdaySaleTime.getDate() - 1);
      const outsideSaleTime = new Date(todaySaleTime);
      outsideSaleTime.setDate(outsideSaleTime.getDate() - 31);

      prisma.sale.findMany.mockResolvedValue([
        { confirmedAt: todaySaleTime, totalAmount: new FakeDecimal(100) },
        { confirmedAt: todaySaleTime, totalAmount: new FakeDecimal(23.5) },
        { confirmedAt: yesterdaySaleTime, totalAmount: new FakeDecimal(75) },
        // Older than the fetched window; bucketing must drop it.
        { confirmedAt: outsideSaleTime, totalAmount: new FakeDecimal(9999) },
      ] as never);

      const result = await service.getDashboard(ACTOR, SUBSCRIPTION_ID);
      const days = result.salesTrend.days;

      expect(days[30]).toEqual({
        date: formatLocalDate(todaySaleTime),
        count: 2,
        totalAmount: '123.5',
      });
      expect(days[29]).toEqual({
        date: formatLocalDate(yesterdaySaleTime),
        count: 1,
        totalAmount: '75',
      });
      expect(days[28]?.count).toBe(0);
      const sumTotal = days.reduce(
        (acc, day) => acc + Number(day.totalAmount),
        0,
      );
      expect(sumTotal).toBeCloseTo(198.5, 6);
    });

    it('keeps a sale with null confirmedAt out of every bucket without throwing', async () => {
      prisma.sale.findMany.mockResolvedValue([
        { confirmedAt: null, totalAmount: new FakeDecimal(50) },
      ] as never);

      const result = await service.getDashboard(ACTOR, SUBSCRIPTION_ID);

      expect(result.salesTrend.days.every((day) => day.count === 0)).toBe(true);
    });

    it('serializes aggregate sums to decimal strings with zero fallbacks', async () => {
      prisma.sale.aggregate
        .mockReset()
        .mockResolvedValueOnce({
          _count: { id: 0 },
          _sum: { totalAmount: null },
        })
        .mockResolvedValueOnce({
          _count: { id: 0 },
          _sum: { totalAmount: null },
        })
        .mockResolvedValueOnce({
          _count: { id: 0 },
          _sum: { totalAmount: null },
        });
      prisma.cashShift.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _sum: { closingDifference: null },
      });

      const result = await service.getDashboard(ACTOR, SUBSCRIPTION_ID);

      expect(result.salesToday).toEqual({ count: 0, totalAmount: '0' });
      expect(result.sales30d).toEqual({
        count: 0,
        totalAmount: '0',
        previousTotal: '0',
      });
      expect(result.cashShifts.differenceAmount30d).toBe('0');
    });

    it('reports the non-trend KPI counters alongside the trend', async () => {
      const result = await service.getDashboard(ACTOR, SUBSCRIPTION_ID);

      expect(result.cashShifts.openCount).toBe(1);
      expect(result.users.pendingApproval).toBe(2);
      expect(result.fiscal).toEqual({ pending: 0, rejected: 0 });
    });

    it('records an ACCESS audit entry for the visited customer after the read', async () => {
      await service.getDashboard(ACTOR, SUBSCRIPTION_ID);

      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledTimes(1);
      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledWith({
        actorUser: ACTOR,
        subscriptionId: SUBSCRIPTION_ID,
        endpoint: `/saas-admin/customers/${SUBSCRIPTION_ID}/dashboard`,
      });
    });
  });
});
