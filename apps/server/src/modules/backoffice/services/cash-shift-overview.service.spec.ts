import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import { RoleType, type User } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('@pharmacy/database', () => ({
  PrismaClient: class {},
}));

import { CashShiftOverviewService } from './cash-shift-overview.service';

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

describe('CashShiftOverviewService', () => {
  let prisma: MockProxy<PrismaClient>;
  let scope: {
    tenantWhere: jest.Mock;
    saleTenantWhere: jest.Mock;
    tenantUserIds: jest.Mock;
    userTenantWhere: jest.Mock;
  };
  let service: CashShiftOverviewService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest.fn().mockReturnValue({}),
      tenantUserIds: jest.fn(),
      userTenantWhere: jest.fn(),
    };
    service = new CashShiftOverviewService(prisma as never, scope as never);

    prisma.cashShift.findMany.mockResolvedValue([]);
    prisma.cashShift.count.mockResolvedValue(12);
    prisma.cashShift.aggregate.mockResolvedValue({
      _count: { id: 3 },
      _sum: { closingDifference: new FakeDecimal(45.5) },
    });
  });

  describe('getCashShifts', () => {
    it('uses default pagination and the tenant scope', async () => {
      const result = await service.getCashShifts(buildUser(), {});

      expect(prisma.cashShift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subscriptionId: 'sub-1' },
          orderBy: { openedAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(1);
    });

    it('clamps page to a minimum of 1', async () => {
      await service.getCashShifts(buildUser(), { page: -2 });

      expect(prisma.cashShift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('clamps pageSize between 1 and 100', async () => {
      await service.getCashShifts(buildUser(), { pageSize: 250 });

      expect(prisma.cashShift.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('merges from/to into an openedAt range on the where clause', async () => {
      await service.getCashShifts(buildUser(), {
        from: '2026-02-01',
        to: '2026-02-28',
      });

      const callArgs = (prisma.cashShift.findMany as jest.Mock).mock
        .calls[0][0];
      expect(callArgs.where.openedAt).toEqual({
        gte: new Date('2026-02-01'),
        lte: new Date('2026-02-28'),
      });
    });

    it('merges state, workstationId and userId filters into the where clause', async () => {
      await service.getCashShifts(buildUser(), {
        state: 'OPEN',
        workstationId: 'ws-2',
        userId: 'u-3',
      });

      const callArgs = (prisma.cashShift.findMany as jest.Mock).mock
        .calls[0][0];
      expect(callArgs.where).toEqual({
        subscriptionId: 'sub-1',
        state: 'OPEN',
        workstationId: 'ws-2',
        userId: 'u-3',
      });
    });

    it('counts rows with the same filtered where clause', async () => {
      await service.getCashShifts(buildUser(), { state: 'OPEN' });

      expect(prisma.cashShift.count).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1', state: 'OPEN' },
      });
    });

    it('summarizes closing differences only over non-zero differences', async () => {
      await service.getCashShifts(buildUser(), { state: 'CLOSED' });

      expect(prisma.cashShift.aggregate).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-1',
          state: 'CLOSED',
          closingDifference: { not: 0 },
        },
        _count: { id: true },
        _sum: { closingDifference: true },
      });
    });

    it('serializes the difference summary and returns the row count', async () => {
      const result = await service.getCashShifts(buildUser(), {});

      expect(result.summary).toEqual({
        differenceCount: 3,
        differenceAmount: '45.5',
      });
    });

    it('returns zero strings when the difference sums are empty', async () => {
      prisma.cashShift.aggregate.mockResolvedValue({
        _count: { id: 0 },
        _sum: { closingDifference: null },
      });

      const result = await service.getCashShifts(buildUser(), {});

      expect(result.summary).toEqual({
        differenceCount: 0,
        differenceAmount: '0',
      });
    });
  });
});