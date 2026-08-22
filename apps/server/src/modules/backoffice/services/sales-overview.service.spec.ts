import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import { RoleType, type User } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('@pharmacy/database', () => ({
  PrismaClient: class {},
  SaleOperationalState: { CONFIRMED: 'CONFIRMED' },
}));

import { SalesOverviewService } from './sales-overview.service';

class FakeDecimal {
  constructor(private readonly value: number) {}

  toString(): string {
    return String(this.value);
  }
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    subscriptionId: 'sub-1',
    role: RoleType.OWNER,
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

describe('SalesOverviewService', () => {
  let prisma: MockProxy<PrismaClient>;
  let scope: {
    tenantWhere: jest.Mock;
    saleTenantWhere: jest.Mock;
    tenantUserIds: jest.Mock;
    userTenantWhere: jest.Mock;
  };
  let service: SalesOverviewService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest
        .fn()
        .mockReturnValue({ cashShift: { subscriptionId: 'sub-1' } }),
      tenantUserIds: jest.fn(),
      userTenantWhere: jest.fn(),
    };
    service = new SalesOverviewService(prisma as never, scope as never);

    prisma.sale.findMany.mockResolvedValue([]);
    prisma.sale.count.mockResolvedValue(25);
    prisma.sale.aggregate.mockResolvedValue({
      _count: { id: 20 },
      _sum: {
        totalAmount: new FakeDecimal(1000),
        totalTax: new FakeDecimal(190),
        totalDiscount: new FakeDecimal(50),
      },
    });
  });

  describe('getSales', () => {
    it('uses default pagination of page 1 and pageSize 20', async () => {
      const result = await service.getSales(buildUser(), {});

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { cashShift: { subscriptionId: 'sub-1' } },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(2);
    });

    it('clamps page to a minimum of 1', async () => {
      await service.getSales(buildUser(), { page: 0 });

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('clamps pageSize between 1 and 100', async () => {
      await service.getSales(buildUser(), { pageSize: 200 });

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('computes skip from page and pageSize', async () => {
      await service.getSales(buildUser(), { page: 3, pageSize: 10 });

      expect(prisma.sale.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('merges from/to into a confirmedAt range on the where clause', async () => {
      await service.getSales(buildUser(), {
        from: '2026-01-01',
        to: '2026-01-31',
      });

      const callArgs = (prisma.sale.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.confirmedAt).toEqual({
        gte: new Date('2026-01-01'),
        lte: new Date('2026-01-31'),
      });
    });

    it('sets only gte when only from is provided', async () => {
      await service.getSales(buildUser(), { from: '2026-01-01' });

      const callArgs = (prisma.sale.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.confirmedAt).toEqual({
        gte: new Date('2026-01-01'),
      });
      expect(callArgs.where.confirmedAt.lte).toBeUndefined();
    });

    it('merges state, userId and workstationId filters into the where clause', async () => {
      await service.getSales(buildUser(), {
        state: 'CONFIRMED',
        userId: 'u-9',
        workstationId: 'ws-4',
      });

      const callArgs = (prisma.sale.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where).toEqual({
        cashShift: { subscriptionId: 'sub-1' },
        operationalState: 'CONFIRMED',
        userId: 'u-9',
        workstationId: 'ws-4',
      });
    });

    it('counts rows with the same filtered where clause', async () => {
      await service.getSales(buildUser(), { state: 'CONFIRMED' });

      expect(prisma.sale.count).toHaveBeenCalledWith({
        where: {
          cashShift: { subscriptionId: 'sub-1' },
          operationalState: 'CONFIRMED',
        },
      });
    });

    it('runs the summary aggregation only over confirmed sales with the filters merged', async () => {
      await service.getSales(buildUser(), { state: 'CONFIRMED' });

      expect(prisma.sale.aggregate).toHaveBeenCalledWith({
        where: {
          cashShift: { subscriptionId: 'sub-1' },
          operationalState: 'CONFIRMED',
          confirmedAt: { not: null },
        },
        _count: { id: true },
        _sum: { totalAmount: true, totalTax: true, totalDiscount: true },
      });
    });

    it('serializes summary Decimals to strings', async () => {
      const result = await service.getSales(buildUser(), {});

      expect(result.summary).toEqual({
        count: 20,
        totalAmount: '1000',
        totalTax: '190',
        totalDiscount: '50',
      });
    });

    it('returns zero strings when the summary sums are empty', async () => {
      prisma.sale.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _sum: { totalAmount: null, totalTax: null, totalDiscount: null },
      });

      const result = await service.getSales(buildUser(), {});

      expect(result.summary).toEqual({
        count: 0,
        totalAmount: '0',
        totalTax: '0',
        totalDiscount: '0',
      });
    });
  });
});