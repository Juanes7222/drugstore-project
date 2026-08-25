import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import { ForbiddenException } from '@nestjs/common';
import { RoleType, type User } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { BackofficeScopeService } from './backoffice-scope.service';

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

describe('BackofficeScopeService', () => {
  let prisma: MockProxy<PrismaClient>;
  let service: BackofficeScopeService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new BackofficeScopeService(prisma as never);
  });

  describe('tenantWhere', () => {
    it('returns subscriptionId filter for tenant roles', () => {
      const result = service.tenantWhere(buildUser());

      expect(result).toEqual({ subscriptionId: 'sub-1' });
    });

    it('scopes SAAS_ADMIN to its own subscription like any other role', () => {
      const result = service.tenantWhere(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(result).toEqual({ subscriptionId: 'sub-1' });
    });

    it('throws ForbiddenException when the caller has no subscriptionId', () => {
      const user = buildUser({ role: RoleType.SAAS_ADMIN, subscriptionId: null });

      expect(() => service.tenantWhere(user)).toThrow(ForbiddenException);
    });
  });

  describe('saleTenantWhere', () => {
    it('returns cashShift subscription filter for tenant roles', () => {
      const result = service.saleTenantWhere(buildUser());

      expect(result).toEqual({ cashShift: { subscriptionId: 'sub-1' } });
    });

    it('scopes SAAS_ADMIN sales through its own subscription', () => {
      const result = service.saleTenantWhere(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(result).toEqual({ cashShift: { subscriptionId: 'sub-1' } });
    });

    it('throws ForbiddenException when the caller has no subscriptionId', () => {
      const user = buildUser({ role: RoleType.SAAS_ADMIN, subscriptionId: null });

      expect(() => service.saleTenantWhere(user)).toThrow(ForbiddenException);
    });
  });

  describe('tenantUserIds', () => {
    it('returns the ids of every user in the caller subscription', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1' },
        { id: 'u2' },
      ] as never);

      const result = await service.tenantUserIds(buildUser());

      expect(prisma.user.findMany).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1' },
        select: { id: true },
      });
      expect(result).toEqual(['u1', 'u2']);
    });

    it('never returns null, even for SAAS_ADMIN callers', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u9' }] as never);

      const result = await service.tenantUserIds(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(result).toEqual(['u9']);
    });

    it('throws ForbiddenException without touching the database when there is no subscriptionId', async () => {
      const user = buildUser({ subscriptionId: null });

      await expect(service.tenantUserIds(user)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('userTenantWhere', () => {
    it('maps tenant user ids into a userId in filter', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1' },
        { id: 'u2' },
      ] as never);

      const result = await service.userTenantWhere(buildUser());

      expect(result).toEqual({ userId: { in: ['u1', 'u2'] } });
    });

    it('always scopes sessions to tenant users, even for SAAS_ADMIN', async () => {
      prisma.user.findMany.mockResolvedValue([{ id: 'u3' }] as never);

      const result = await service.userTenantWhere(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(result).toEqual({ userId: { in: ['u3'] } });
    });
  });
});
