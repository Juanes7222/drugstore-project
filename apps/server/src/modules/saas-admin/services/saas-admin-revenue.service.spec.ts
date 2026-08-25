import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SaasAdminRevenueService } from './saas-admin-revenue.service';
import { DomainException } from '@/common/exceptions/domain.exception';

const { Prisma } = jest.requireMock('@pharmacy/database');

const ACTOR = { id: 'admin-1', role: 'SAAS_ADMIN' };
const SUBSCRIPTION_ID = 'sub-1';

/** Local first-of-month N months before "now" — mirrors the service. */
function startOfMonthNMonthsAgo(monthsAgo: number): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - monthsAgo, 1);
}

function monthKeyOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${date.getFullYear()}-${month}`;
}

function centsToUnits(cents: number): string {
  return new Prisma.Decimal(cents).dividedBy(100).toString();
}

describe('SaasAdminRevenueService', () => {
  let prisma: MockProxy<PrismaClient>;
  let accessAudit: { recordCustomerAccess: ReturnType<typeof jest.fn> };
  let service: SaasAdminRevenueService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-08-24T10:00:00.000Z'));

    prisma = mockDeep<PrismaClient>();
    accessAudit = {
      recordCustomerAccess: jest.fn<(input: unknown) => Promise<void>>(),
    };
    accessAudit.recordCustomerAccess.mockResolvedValue(undefined);

    service = new SaasAdminRevenueService(prisma as never, accessAudit as never);

    prisma.subscriptionPaymentHistory.findMany.mockResolvedValue([]);
    prisma.subscription.groupBy.mockResolvedValue([]);
    prisma.plan.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getRevenue', () => {
    it('zero-fills 12 months oldest→newest and returns decimal-string amounts', async () => {
      prisma.subscriptionPaymentHistory.findMany.mockResolvedValue([
        // Inside last30d and inside the current month bucket.
        { amountCents: 19_900_000, recordedAt: new Date('2026-08-10T15:00:00Z') },
        // ~45 days old: in the July bucket, outside last30d.
        { amountCents: 500_000, recordedAt: new Date('2026-07-10T15:00:00Z') },
      ] as never);

      const result = await service.getRevenue();

      expect(result.last30d).toEqual({ totalAmount: '199000', count: 1 });
      expect(result.revenueByMonth).toHaveLength(12);
      expect(result.revenueByMonth[0]?.month).toBe(
        monthKeyOf(startOfMonthNMonthsAgo(11)),
      );
      expect(result.revenueByMonth[11]?.month).toBe(
        monthKeyOf(startOfMonthNMonthsAgo(0)),
      );

      const byKey = new Map(
        result.revenueByMonth.map((row) => [row.month, row]),
      );
      const current = byKey.get(monthKeyOf(startOfMonthNMonthsAgo(0)));
      expect(current).toEqual({
        month: monthKeyOf(startOfMonthNMonthsAgo(0)),
        totalAmount: '199000',
        count: 1,
      });
      const july = byKey.get('2026-07');
      expect(july).toEqual({ month: '2026-07', totalAmount: '5000', count: 1 });

      // Every untouched bucket is zero-filled with a decimal string.
      for (const row of result.revenueByMonth) {
        if (row.month !== '2026-08' && row.month !== '2026-07') {
          expect(row).toEqual({
            month: row.month,
            totalAmount: '0',
            count: 0,
          });
        }
      }
    });

    it('fetches payments from the first day of the month 11 months back', async () => {
      await service.getRevenue();

      expect(prisma.subscriptionPaymentHistory.findMany).toHaveBeenCalledWith({
        where: {
          recordedAt: { gte: startOfMonthNMonthsAgo(11) },
        },
        select: { amountCents: true, recordedAt: true },
      });
    });

    it('maps ACTIVE-subscription plan groups to a displayOrder-sorted distribution', async () => {
      prisma.subscription.groupBy.mockResolvedValue([
        { planId: 'p-cert', _count: { _all: 1 } },
        { planId: 'p-provider', _count: { _all: 3 } },
      ] as never);
      prisma.plan.findMany.mockResolvedValue([
        {
          id: 'p-provider',
          code: 'PROVIDER',
          name: 'Farmacia con facturación incluida',
          basePriceCents: 19_900_000,
          billingPeriod: 'MONTHLY',
          displayOrder: 1,
        },
        {
          id: 'p-cert',
          code: 'CERTIFICATE',
          name: 'Farmacia con tu certificado DIAN',
          basePriceCents: 35_820_000,
          billingPeriod: 'QUARTERLY',
          displayOrder: 2,
        },
      ] as never);

      const result = await service.getRevenue();

      expect(prisma.subscription.groupBy).toHaveBeenCalledWith({
        by: ['planId'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      });
      expect(result.planDistribution).toEqual([
        { planCode: 'PROVIDER', planName: 'Farmacia con facturación incluida', activeSubscriptions: 3 },
        { planCode: 'CERTIFICATE', planName: 'Farmacia con tu certificado DIAN', activeSubscriptions: 1 },
      ]);
    });

    it('computes MRR normalized per billing period and rounds once at the end', async () => {
      prisma.subscription.groupBy.mockResolvedValue([
        { planId: 'p-provider', _count: { _all: 3 } }, // 19,900,000 × 3 monthly
        { planId: 'p-cert', _count: { _all: 1 } }, // 35,820,000 ÷ 3 quarterly
      ] as never);
      prisma.plan.findMany.mockResolvedValue([
        {
          id: 'p-provider',
          code: 'PROVIDER',
          name: 'P',
          basePriceCents: 19_900_000,
          billingPeriod: 'MONTHLY',
          displayOrder: 1,
        },
        {
          id: 'p-cert',
          code: 'CERTIFICATE',
          name: 'C',
          basePriceCents: 35_820_000,
          billingPeriod: 'QUARTERLY',
          displayOrder: 2,
        },
      ] as never);

      const result = await service.getRevenue();

      // 59,700,000 + 11,940,000 = 71,640,000 cents → 716,400 units.
      expect(result.mrr).toBe(centsToUnits(new Prisma.Decimal(71_640_000)));
      expect(result.mrr).toBe('716400');
    });

    it('normalizes ANNUAL plans to one twelfth of the price', async () => {
      prisma.subscription.groupBy.mockResolvedValue([
        { planId: 'annual', _count: { _all: 2 } },
      ] as never);
      prisma.plan.findMany.mockResolvedValue([
        {
          id: 'annual',
          code: 'ANNUAL',
          name: 'A',
          basePriceCents: 23_880_000, // 23,880,000 ÷ 12 × 2 = 3,980,000 cents/mo
          billingPeriod: 'ANNUAL',
          displayOrder: 1,
        },
      ] as never);

      const result = await service.getRevenue();

      expect(result.mrr).toBe('39800');
    });

    it('returns null MRR when no ACTIVE subscriptions exist', async () => {
      prisma.subscription.groupBy.mockResolvedValue([] as never);

      const result = await service.getRevenue();

      expect(result.mrr).toBeNull();
      expect(result.planDistribution).toEqual([]);
    });

    it('returns null MRR when every plan price is zero', async () => {
      prisma.subscription.groupBy.mockResolvedValue([
        { planId: 'free', _count: { _all: 5 } },
      ] as never);
      prisma.plan.findMany.mockResolvedValue([
        {
          id: 'free',
          code: 'FREE',
          name: 'Free',
          basePriceCents: 0,
          billingPeriod: 'MONTHLY',
          displayOrder: 1,
        },
      ] as never);

      const result = await service.getRevenue();

      expect(result.mrr).toBeNull();
    });
  });

  describe('getCustomerPayments', () => {
    const PAYMENT_ROW = {
      id: 'pay-1',
      subscriptionId: SUBSCRIPTION_ID,
      amountCents: 19_900_000,
      currency: 'COP',
      paymentMethod: 'WOMPI',
      paymentReference: 'wompi-ref-1',
      notes: null,
      recordedAt: new Date('2026-08-10T15:00:00.000Z'),
      createdAt: new Date('2026-08-10T15:00:01.000Z'),
    };

    it('pages newest-first and adapts row names to the real model', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: SUBSCRIPTION_ID } as never);
      prisma.subscriptionPaymentHistory.findMany.mockResolvedValue([PAYMENT_ROW] as never);
      prisma.subscriptionPaymentHistory.count.mockResolvedValue(12);

      const result = await service.getCustomerPayments(ACTOR, SUBSCRIPTION_ID, {
        page: 2,
        pageSize: 5,
      });

      expect(prisma.subscriptionPaymentHistory.findMany).toHaveBeenCalledWith({
        where: { subscriptionId: SUBSCRIPTION_ID },
        orderBy: [{ recordedAt: 'desc' }, { createdAt: 'desc' }],
        skip: 5,
        take: 5,
      });
      expect(result.data).toEqual([
        {
          id: 'pay-1',
          amount: '199000',
          currency: 'COP',
          method: 'WOMPI',
          externalReference: 'wompi-ref-1',
          recordedAt: '2026-08-10T15:00:00.000Z',
          createdAt: '2026-08-10T15:00:01.000Z',
        },
      ]);
      expect(result.total).toBe(12);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(5);
      expect(result.totalPages).toBe(3);
      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUser: ACTOR,
          subscriptionId: SUBSCRIPTION_ID,
          endpoint: '/saas-admin/customers/sub-1/payments',
        }),
      );
    });

    it('throws SUBSCRIPTION_NOT_FOUND (404) for an unknown subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null as never);

      const error = (
        await service
          .getCustomerPayments(ACTOR, 'missing', {})
          .catch((caught: unknown) => caught)
      ) as DomainException | undefined;

      expect(error).toBeInstanceOf(DomainException);
      expect(error?.errorCode).toBe('SUBSCRIPTION_NOT_FOUND');
      expect(error?.getStatus()).toBe(404);
      expect(prisma.subscriptionPaymentHistory.findMany).not.toHaveBeenCalled();
    });

    it('defaults paging to page 1 / pageSize 20', async () => {
      prisma.subscription.findUnique.mockResolvedValue({ id: SUBSCRIPTION_ID } as never);
      prisma.subscriptionPaymentHistory.findMany.mockResolvedValue([] as never);
      prisma.subscriptionPaymentHistory.count.mockResolvedValue(0);

      await service.getCustomerPayments(ACTOR, SUBSCRIPTION_ID, {});

      expect(prisma.subscriptionPaymentHistory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });
  });
});
