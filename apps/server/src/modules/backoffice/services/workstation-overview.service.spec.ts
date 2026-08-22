import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import { RoleType, type User } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
jest.mock('@pharmacy/database', () => ({
  PrismaClient: class {},
  SessionStatus: { ACTIVE: 'ACTIVE' },
  SaleOperationalState: { CONFIRMED: 'CONFIRMED' },
}));

import { WorkstationOverviewService } from './workstation-overview.service';

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

describe('WorkstationOverviewService', () => {
  let prisma: MockProxy<PrismaClient>;
  let scope: {
    tenantWhere: jest.Mock;
    saleTenantWhere: jest.Mock;
    tenantUserIds: jest.Mock;
    userTenantWhere: jest.Mock;
  };
  let service: WorkstationOverviewService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest
        .fn()
        .mockReturnValue({ cashShift: { subscriptionId: 'sub-1' } }),
      tenantUserIds: jest.fn().mockResolvedValue(['u1', 'u2']),
      userTenantWhere: jest.fn(),
    };
    service = new WorkstationOverviewService(prisma as never, scope as never);

    prisma.workstation.findMany.mockResolvedValue([]);
    prisma.userSession.findMany.mockResolvedValue([]);
    prisma.userSession.groupBy.mockResolvedValue([]);
    prisma.sale.groupBy.mockResolvedValue([]);
    prisma.userSession.count.mockResolvedValue(0);
  });

  describe('getWorkstations', () => {
    it('lets SAAS_ADMIN see every workstation without a filter', async () => {
      prisma.workstation.findMany.mockResolvedValue([
        { id: 'ws-1', name: 'Caja 1' },
      ] as never);

      const result = await service.getWorkstations(
        buildUser({ role: RoleType.SAAS_ADMIN }),
      );

      expect(prisma.workstation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
      expect(prisma.userSession.findMany).not.toHaveBeenCalled();
      expect(result.workstations).toHaveLength(1);
    });

    it('restricts non-SAAS_ADMIN to workstations with tenant user sessions', async () => {
      prisma.userSession.findMany.mockResolvedValue([
        { workstationId: 'ws-1' },
        { workstationId: 'ws-2' },
      ] as never);

      await service.getWorkstations(buildUser());

      expect(prisma.userSession.findMany).toHaveBeenCalledWith({
        where: { userId: { in: ['u1', 'u2'] }, status: 'ACTIVE' },
        select: { workstationId: true },
        distinct: ['workstationId'],
      });
      expect(prisma.workstation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['ws-1', 'ws-2'] } } }),
      );
    });

    it('falls back to no workstation filter when tenantUserIds returns null', async () => {
      scope.tenantUserIds.mockResolvedValue(null);

      await service.getWorkstations(buildUser());

      expect(prisma.workstation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('enriches workstations with active session and sales-today counts', async () => {
      prisma.workstation.findMany.mockResolvedValue([
        { id: 'ws-1', name: 'Caja 1' },
        { id: 'ws-2', name: 'Caja 2' },
        { id: 'ws-3', name: 'Caja 3' },
      ] as never);
      prisma.userSession.groupBy.mockResolvedValue([
        { workstationId: 'ws-1', _count: { _all: 3 } },
      ] as never);
      prisma.sale.groupBy.mockResolvedValue([
        { workstationId: 'ws-2', _count: { _all: 5 } },
      ] as never);
      prisma.userSession.count.mockResolvedValue(9);

      const result = await service.getWorkstations(buildUser());

      expect(result.workstations).toEqual([
        { id: 'ws-1', name: 'Caja 1', activeSessions: 3, salesToday: 0 },
        { id: 'ws-2', name: 'Caja 2', activeSessions: 0, salesToday: 5 },
        { id: 'ws-3', name: 'Caja 3', activeSessions: 0, salesToday: 0 },
      ]);
      expect(result.activeSessionCount).toBe(9);
    });

    it('groups sales today by workstation with the sale tenant scope', async () => {
      await service.getWorkstations(buildUser());

      expect(prisma.sale.groupBy).toHaveBeenCalledWith({
        by: ['workstationId'],
        where: expect.objectContaining({
          cashShift: { subscriptionId: 'sub-1' },
          confirmedAt: { gte: expect.any(Date) },
          operationalState: 'CONFIRMED',
        }),
        _count: { _all: true },
      });
    });

    it('counts all active sessions for the activeSessionCount metric', async () => {
      await service.getWorkstations(buildUser());

      expect(prisma.userSession.count).toHaveBeenCalledWith({
        where: { status: 'ACTIVE' },
      });
    });
  });
});