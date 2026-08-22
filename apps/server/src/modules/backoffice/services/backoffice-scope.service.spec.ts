import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import { ForbiddenException } from '@nestjs/common';
import { RoleType, type User } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('@pharmacy/database', () => ({
  PrismaClient: class {},
}));

import { BackofficeScopeService } from './backoffice-scope.service';

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

describe('BackofficeScopeService', () => {
  let prisma: MockProxy<PrismaClient>;
  let service: BackofficeScopeService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new BackofficeScopeService(prisma as never);
  });

  describe('tenantWhere', () => {
    it('returns no filter for SAAS_ADMIN', () => {
      const result = service.tenantWhere(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(result).toEqual({});
    });

    it('returns subscriptionId filter for non-SAAS_ADMIN roles', () => {
      const result = service.tenantWhere(buildUser());

      expect(result).toEqual({ subscriptionId: 'sub-1' });
    });

    it('throws ForbiddenException when non-SAAS_ADMIN has no subscriptionId', () => {
      const user = buildUser({ subscriptionId: null });

      expect(() => service.tenantWhere(user)).toThrow(ForbiddenException);
    });
  });

  describe('saleTenantWhere', () => {
    it('returns no filter for SAAS_ADMIN', () => {
      const result = service.saleTenantWhere(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(result).toEqual({});
    });

    it('returns cashShift subscription filter for non-SAAS_ADMIN roles', () => {
      const result = service.saleTenantWhere(buildUser());

      expect(result).toEqual({ cashShift: { subscriptionId: 'sub-1' } });
    });

    it('throws ForbiddenException when non-SAAS_ADMIN has no subscriptionId', () => {
      const user = buildUser({ subscriptionId: null });

      expect(() => service.saleTenantWhere(user)).toThrow(ForbiddenException);
    });
  });

  describe('tenantUserIds', () => {
    it('returns null for SAAS_ADMIN without touching the database', async () => {
      const result = await service.tenantUserIds(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(result).toBeNull();
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

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

    it('throws ForbiddenException when non-SAAS_ADMIN has no subscriptionId', async () => {
      const user = buildUser({ subscriptionId: null });

      await expect(service.tenantUserIds(user)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });
  });

  describe('userTenantWhere', () => {
    it('returns empty filter for SAAS_ADMIN without touching the database', async () => {
      const result = await service.userTenantWhere(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(result).toEqual({});
      expect(prisma.user.findMany).not.toHaveBeenCalled();
    });

    it('maps tenant user ids into a userId in filter', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'u1' },
        { id: 'u2' },
      ] as never);

      const result = await service.userTenantWhere(buildUser());

      expect(result).toEqual({ userId: { in: ['u1', 'u2'] } });
    });
  });
});