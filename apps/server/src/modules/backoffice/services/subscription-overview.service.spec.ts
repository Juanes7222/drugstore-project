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

import { SubscriptionOverviewService } from './subscription-overview.service';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    subscriptionId: 'sub-1',
    role: RoleType.SAAS_ADMIN,
    isPlatformAdmin: false,
    email: 'admin@example.com',
    username: 'admin',
    displayName: 'Admin',
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

describe('SubscriptionOverviewService', () => {
  let prisma: MockProxy<PrismaClient>;
  let service: SubscriptionOverviewService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new SubscriptionOverviewService(prisma as never);

    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.subscription.count.mockResolvedValue(45);
  });

  describe('getSubscriptions', () => {
    it('uses default pagination of page 1 and pageSize 20', async () => {
      const result = await service.getSubscriptions(buildUser(), {});

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(3);
    });

    it('clamps page to a minimum of 1', async () => {
      await service.getSubscriptions(buildUser(), { page: -1 });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('clamps pageSize between 1 and 100', async () => {
      await service.getSubscriptions(buildUser(), { pageSize: 250 });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('computes skip from page and pageSize', async () => {
      await service.getSubscriptions(buildUser(), {
        page: 2,
        pageSize: 10,
      });

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('selects plan, location, activation and fraud alert counts', async () => {
      await service.getSubscriptions(buildUser(), {});

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            customerName: true,
            customerTaxId: true,
            status: true,
            plan: { select: { code: true, name: true } },
            _count: {
              select: {
                locations: true,
                workstationActivations: true,
                fraudAlerts: true,
              },
            },
          }),
        }),
      );
    });

    it('counts all subscriptions without arguments', async () => {
      await service.getSubscriptions(buildUser(), {});

      expect(prisma.subscription.count).toHaveBeenCalledWith();
    });

    it('returns the pagination envelope with data and total', async () => {
      const rows = [{ id: 'sub-9', customerName: 'Farmacia X' }];
      prisma.subscription.findMany.mockResolvedValue(rows as never);

      const result = await service.getSubscriptions(buildUser(), {});

      expect(result.data).toEqual(rows);
      expect(result.total).toBe(45);
    });
  });
});
