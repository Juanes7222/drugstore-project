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

import { SessionOverviewService } from './session-overview.service';

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

describe('SessionOverviewService', () => {
  let prisma: MockProxy<PrismaClient>;
  let scope: {
    tenantWhere: jest.Mock;
    saleTenantWhere: jest.Mock;
    tenantUserIds: jest.Mock;
    userTenantWhere: jest.Mock;
  };
  let service: SessionOverviewService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest.fn().mockReturnValue({}),
      tenantUserIds: jest.fn(),
      userTenantWhere: jest
        .fn()
        .mockResolvedValue({ userId: { in: ['u1', 'u2'] } }),
    };
    service = new SessionOverviewService(prisma as never, scope as never);

    prisma.userSession.findMany.mockResolvedValue([]);
    prisma.userSession.count.mockResolvedValue(11);
  });

  describe('getActiveSessions', () => {
    it('merges the ACTIVE status filter with the user-scope filter', async () => {
      const result = await service.getActiveSessions(buildUser(), {});

      expect(prisma.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE', userId: { in: ['u1', 'u2'] } },
          orderBy: { lastActivityAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(prisma.userSession.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE', userId: { in: ['u1', 'u2'] } },
      });
      expect(result.total).toBe(11);
      expect(result.totalPages).toBe(1);
    });

    it('keeps only the ACTIVE status filter when the user scope is empty', async () => {
      scope.userTenantWhere.mockResolvedValue({});

      await service.getActiveSessions(buildUser(), {});

      expect(prisma.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'ACTIVE' } }),
      );
    });

    it('clamps page to a minimum of 1', async () => {
      await service.getActiveSessions(buildUser(), { page: 0 });

      expect(prisma.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('clamps pageSize between 1 and 100', async () => {
      await service.getActiveSessions(buildUser(), { pageSize: 500 });

      expect(prisma.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('computes skip from page and pageSize', async () => {
      await service.getActiveSessions(buildUser(), {
        page: 4,
        pageSize: 25,
      });

      expect(prisma.userSession.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 75, take: 25 }),
      );
    });
  });
});
