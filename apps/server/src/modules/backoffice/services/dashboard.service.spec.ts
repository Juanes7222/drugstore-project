import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import { RoleType, type User } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DashboardService } from './dashboard.service';

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

// Fixtures feed real Prisma.Decimal arithmetic in the service, so they must
// be real Decimals (loaded from the mocked module), not a local fake.
const { Prisma } = jest.requireMock('@pharmacy/database');
function FakeDecimal(value: number) {
  return new Prisma.Decimal(value);
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    subscriptionId: 'sub-1',
    role: RoleType.OWNER,
    isPlatformAdmin: false,
    email: 'owner@example.com',
    username: 'owner',
    displayName: 'Owner',
    avatarUrl: null,
    avatarColor: null,
    authMethod: 'PASSWORD_ONLY' as User['authMethod'],
    identificationType: null,
    identificationNumber: null,
    isActive: true,
    totpEnabled: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    emailVerifiedAt: null,
    lastLoginAt: null,
    lastLoginWorkstationId: null,
    lastPasswordChangeAt: null,
    status: 'ACTIVE' as User['status'],
    mustChangePassword: false,
    createdByUserId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('DashboardService', () => {
  let prisma: MockProxy<PrismaClient>;
  let scope: {
    tenantWhere: jest.Mock;
    saleTenantWhere: jest.Mock;
    tenantUserIds: jest.Mock;
    userTenantWhere: jest.Mock;
  };
  let service: DashboardService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest
        .fn()
        .mockReturnValue({ cashShift: { subscriptionId: 'sub-1' } }),
      tenantUserIds: jest.fn().mockResolvedValue(['u1', 'u2']),
      userTenantWhere: jest.fn().mockResolvedValue({}),
    };
    service = new DashboardService(prisma as never, scope as never);

    prisma.sale.aggregate
      .mockResolvedValueOnce({
        _count: { id: 2 },
        _sum: { totalAmount: new FakeDecimal(125) },
      })
      .mockResolvedValueOnce({
        _count: { id: 1 },
        _sum: { totalAmount: new FakeDecimal(50) },
      });
    prisma.sale.findMany.mockResolvedValue([]);
    prisma.cashShift.count.mockResolvedValue(3);
    prisma.cashShift.aggregate.mockResolvedValue({
      _count: { id: 4 },
      _sum: { closingDifference: new FakeDecimal(12.5) },
    });
    prisma.inventoryAdjustmentDocument.count.mockResolvedValue(5);
    prisma.lot.count.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    prisma.fiscalDocument.groupBy.mockResolvedValue([]);
    prisma.syncQueue.count.mockResolvedValue(6);
    prisma.user.count.mockResolvedValue(7);
    prisma.userSession.count.mockResolvedValue(8);
  });

  describe('getDashboard', () => {
    it('merges the sale tenant scope into confirmed and annulled sale aggregates', async () => {
      await service.getDashboard(buildUser());

      expect(prisma.sale.aggregate).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            cashShift: { subscriptionId: 'sub-1' },
            confirmedAt: { gte: expect.any(Date) },
            operationalState: 'CONFIRMED',
          }),
          _count: { id: true },
          _sum: { totalAmount: true },
        }),
      );
      expect(prisma.sale.aggregate).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            cashShift: { subscriptionId: 'sub-1' },
            annulledAt: { gte: expect.any(Date) },
            operationalState: 'ANNULLED',
          }),
        }),
      );
    });

    it('merges the tenant scope into every tenant-scoped query', async () => {
      await service.getDashboard(buildUser());

      expect(prisma.cashShift.count).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1', state: 'OPEN' },
      });
      expect(prisma.cashShift.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            subscriptionId: 'sub-1',
            closedAt: { gte: expect.any(Date) },
            closingDifference: { not: 0 },
          }),
        }),
      );
      expect(prisma.inventoryAdjustmentDocument.count).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-1',
          submittedForApprovalAt: { not: null },
          approvedAt: null,
          rejectedAt: null,
        },
      });
      expect(prisma.lot.count).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            currentStock: { gt: 0 },
            expirationDate: { gte: expect.any(Date), lte: expect.any(Date) },
            product: { subscriptionId: 'sub-1' },
          }),
        }),
      );
      expect(prisma.lot.count).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: expect.objectContaining({
            expirationDate: { lt: expect.any(Date) },
            product: { subscriptionId: 'sub-1' },
          }),
        }),
      );
      expect(prisma.syncQueue.count).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1', status: 'PERMANENT_FAILURE' },
      });
      expect(prisma.user.count).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1', status: 'PENDING_SETUP' },
      });
    });

    it('passes the tenant scope and issueDate window into the fiscal groupBy', async () => {
      prisma.fiscalDocument.groupBy.mockResolvedValue([]);

      await service.getDashboard(buildUser());

      expect(prisma.fiscalDocument.groupBy).toHaveBeenCalledWith({
        by: ['fiscalState'],
        where: {
          subscriptionId: 'sub-1',
          issueDate: { gte: expect.any(Date) },
        },
        _count: { _all: true },
      });
    });

    it('restricts active session count to tenant users when they exist', async () => {
      await service.getDashboard(buildUser());

      expect(prisma.userSession.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', userId: { in: ['u1', 'u2'] } },
      });
    });

    it('keeps the session count tenant-scoped even for SAAS_ADMIN callers', async () => {
      scope.tenantUserIds.mockResolvedValue(['u9']);

      await service.getDashboard(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(prisma.userSession.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', userId: { in: ['u9'] } },
      });
    });

    it('serializes Decimal sums to strings in the response', async () => {
      const result = await service.getDashboard(buildUser());

      expect(result.sales.confirmedTotal).toBe('125');
      expect(result.sales.annulledTotal).toBe('50');
      expect(result.sales.averageTicket).toBe('62.5');
      expect(result.cashShifts.differenceAmount30d).toBe('12.5');
      expect(result.cashShifts.differenceCount30d).toBe(4);
    });

    it('returns zeroed strings when every aggregate sum is empty', async () => {
      prisma.sale.aggregate
        .mockReset()
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

      const result = await service.getDashboard(buildUser());

      expect(result.sales.confirmedCount).toBe(0);
      expect(result.sales.confirmedTotal).toBe('0');
      expect(result.sales.averageTicket).toBe('0');
      expect(result.sales.annulledTotal).toBe('0');
      expect(result.cashShifts.differenceAmount30d).toBe('0');
    });

    it('summarizes fiscal states into validated, pending, rejected, errors and contingency buckets', async () => {
      prisma.fiscalDocument.groupBy.mockResolvedValue([
        { fiscalState: 'VALIDATED', _count: { _all: 3 } },
        { fiscalState: 'REJECTED', _count: { _all: 2 } },
        { fiscalState: 'CONTINGENCY', _count: { _all: 1 } },
        { fiscalState: 'PENDING_GENERATION', _count: { _all: 4 } },
        { fiscalState: 'PENDING_SIGNATURE', _count: { _all: 4 } },
        { fiscalState: 'PENDING_TRANSMISSION', _count: { _all: 4 } },
        { fiscalState: 'IN_TRANSMISSION', _count: { _all: 4 } },
        { fiscalState: 'PENDING_RESPONSE', _count: { _all: 4 } },
        { fiscalState: 'GENERATION_ERROR', _count: { _all: 2 } },
        { fiscalState: 'SIGNATURE_ERROR', _count: { _all: 2 } },
        { fiscalState: 'UNKNOWN_STATE', _count: { _all: 9 } },
      ] as never);

      const result = await service.getDashboard(buildUser());

      expect(result.fiscal).toEqual({
        validated: 3,
        pending: 20,
        rejected: 2,
        errors: 4,
        contingency: 1,
      });
    });

    it('returns the period window and remaining counters', async () => {
      const result = await service.getDashboard(buildUser());

      expect(result.period.from).toEqual(expect.any(String));
      expect(result.period.to).toEqual(expect.any(String));
      expect(result.inventory).toEqual({
        pendingAdjustments: 5,
        expiringLots: 2,
        expiredLots: 1,
      });
      expect(result.sync).toEqual({ permanentFailures: 6 });
      expect(result.users).toEqual({ pendingApproval: 7, activeSessions: 8 });
    });

    it('merges the sale tenant scope into the 14-day trend query', async () => {
      await service.getDashboard(buildUser());

      expect(prisma.sale.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.sale.findMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          cashShift: { subscriptionId: 'sub-1' },
          confirmedAt: { gte: expect.any(Date), lt: expect.any(Date) },
          operationalState: 'CONFIRMED',
        }),
        select: { confirmedAt: true, totalAmount: true },
      });

      const { gte, lt } = (
        prisma.sale.findMany.mock.calls[0][0] as {
          where: { confirmedAt: { gte: Date; lt: Date } };
        }
      ).where.confirmedAt;
      const DAY_MS = 24 * 60 * 60 * 1000;
      expect(lt.getTime() - gte.getTime()).toBe(14 * DAY_MS);
    });

    it('returns 14 zero-filled days ascending ending today when no sales exist', async () => {
      prisma.sale.findMany.mockResolvedValue([]);

      const result = await service.getDashboard(buildUser());
      const days = result.salesTrend.days;

      expect(days).toHaveLength(14);
      days.forEach((day) => {
        expect(day.confirmedCount).toBe(0);
        expect(day.confirmedAmount).toBe('0');
      });

      const today = formatLocalDate(new Date());
      const oldest = new Date();
      oldest.setDate(oldest.getDate() - 13);
      expect(days[13].date).toBe(today);
      expect(days[0].date).toBe(formatLocalDate(oldest));

      for (let i = 1; i < days.length; i += 1) {
        expect(days[i].date > days[i - 1].date).toBe(true);
      }
    });

    it('buckets trend sales by local day with decimal-string amounts', async () => {
      const todaySaleTime = new Date();
      todaySaleTime.setHours(10, 30, 0, 0);
      const yesterdaySaleTime = new Date(todaySaleTime);
      yesterdaySaleTime.setDate(yesterdaySaleTime.getDate() - 1);

      prisma.sale.findMany.mockResolvedValue([
        { confirmedAt: todaySaleTime, totalAmount: new FakeDecimal(100) },
        { confirmedAt: todaySaleTime, totalAmount: new FakeDecimal(23.5) },
        { confirmedAt: yesterdaySaleTime, totalAmount: new FakeDecimal(75) },
      ] as never);

      const result = await service.getDashboard(buildUser());
      const days = result.salesTrend.days;

      expect(days[13]).toEqual({
        date: formatLocalDate(todaySaleTime),
        confirmedCount: 2,
        confirmedAmount: '123.5',
      });
      expect(days[12]).toEqual({
        date: formatLocalDate(yesterdaySaleTime),
        confirmedCount: 1,
        confirmedAmount: '75',
      });
      expect(days[11].confirmedCount).toBe(0);
    });

    it('keeps the today window and two sale aggregates when no period is given', async () => {
      await service.getDashboard(buildUser());

      expect(prisma.sale.aggregate).toHaveBeenCalledTimes(2);
      const { gte, lt } = (
        prisma.sale.findMany.mock.calls[0][0] as {
          where: { confirmedAt: { gte: Date; lt: Date } };
        }
      ).where.confirmedAt;
      expect(gte.getTime()).toBe(localMidnight(13).getTime());
      expect(lt.getTime()).toBe(localMidnight(-1).getTime());
    });

    it('windows sales on the last 7 calendar days without a confirmed aggregate', async () => {
      const result = await service.getDashboard(buildUser(), '7d');

      // Only the annulled aggregate runs; current-window metrics come from rows.
      expect(prisma.sale.aggregate).toHaveBeenCalledTimes(1);
      expect(prisma.sale.aggregate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            annulledAt: { gte: localMidnight(6) },
            operationalState: 'ANNULLED',
          }),
        }),
      );

      const { gte, lt } = (
        prisma.sale.findMany.mock.calls[0][0] as {
          where: { confirmedAt: { gte: Date; lt: Date } };
        }
      ).where.confirmedAt;
      // Widened to cover the previous 7-day window: todayStart-13 .. tomorrow.
      expect(gte.getTime()).toBe(localMidnight(13).getTime());
      expect(lt.getTime()).toBe(localMidnight(-1).getTime());

      expect(result.salesTrend.days).toHaveLength(7);
      const days = result.salesTrend.days;
      for (let i = 1; i < days.length; i += 1) {
        expect(days[i].date > days[i - 1].date).toBe(true);
      }
      expect(days[days.length - 1].date).toBe(formatLocalDate(new Date()));
      expect(result.period.from).toBe(localMidnight(6).toISOString());
    });

    it('windows sales on the last 30 calendar days with a 30-bucket trend', async () => {
      const result = await service.getDashboard(buildUser(), '30d');

      expect(prisma.sale.aggregate).toHaveBeenCalledTimes(1);

      const { gte, lt } = (
        prisma.sale.findMany.mock.calls[0][0] as {
          where: { confirmedAt: { gte: Date; lt: Date } };
        }
      ).where.confirmedAt;
      expect(gte.getTime()).toBe(localMidnight(59).getTime());
      expect(lt.getTime()).toBe(localMidnight(-1).getTime());

      expect(result.salesTrend.days).toHaveLength(30);
      expect(result.salesTrend.days[29].date).toBe(formatLocalDate(new Date()));
      expect(result.period.from).toBe(localMidnight(29).toISOString());
    });

    it('compares the 7d window against the preceding 7-day window', async () => {
      const previousSaleTime = localMidnight(8);
      previousSaleTime.setHours(10, 0, 0, 0);
      const secondPreviousSaleTime = localMidnight(10);
      secondPreviousSaleTime.setHours(15, 0, 0, 0);
      const currentSaleTime = new Date();
      currentSaleTime.setHours(10, 30, 0, 0);

      prisma.sale.findMany.mockResolvedValue([
        { confirmedAt: previousSaleTime, totalAmount: new FakeDecimal(100) },
        {
          confirmedAt: secondPreviousSaleTime,
          totalAmount: new FakeDecimal(23.5),
        },
        { confirmedAt: currentSaleTime, totalAmount: new FakeDecimal(75) },
      ] as never);

      const result = await service.getDashboard(buildUser(), '7d');

      expect(result.sales.previousCount).toBe(2);
      expect(result.sales.previousTotal).toBe('123.5');
      expect(result.sales.previousAverageTicket).toBe('61.75');
      expect(result.sales.confirmedCount).toBe(1);
      expect(result.sales.confirmedTotal).toBe('75');
      expect(result.sales.averageTicket).toBe('75');
    });

    it('returns zeroed previous-window totals with a null average when none exist', async () => {
      prisma.sale.findMany.mockResolvedValue([]);

      const result = await service.getDashboard(buildUser(), '7d');

      expect(result.sales.previousCount).toBe(0);
      expect(result.sales.previousTotal).toBe('0');
      expect(result.sales.previousAverageTicket).toBeNull();
    });
  });
});
