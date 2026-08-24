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

import { AuditLogOverviewService } from './audit-log-overview.service';

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

function buildAuditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'audit-1',
    action: 'STATE_CHANGE',
    module: 'SALES_POS',
    entityId: 'sale-9',
    details: null,
    ipAddress: '192.168.0.10',
    createdAt: new Date('2026-03-01T12:00:00.000Z'),
    user: { fullName: 'Ana Perez', displayName: null },
    ...overrides,
  };
}

describe('AuditLogOverviewService', () => {
  let prisma: MockProxy<PrismaClient>;
  let scope: {
    tenantWhere: jest.Mock;
    saleTenantWhere: jest.Mock;
    tenantUserIds: jest.Mock;
    userTenantWhere: jest.Mock;
  };
  let service: AuditLogOverviewService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest.fn().mockReturnValue({}),
      tenantUserIds: jest.fn(),
      userTenantWhere: jest.fn().mockResolvedValue({}),
    };
    service = new AuditLogOverviewService(prisma as never, scope as never);

    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(11);
  });

  describe('getAuditLogs', () => {
    it('scopes findMany and count to the caller subscription and sorts newest first', async () => {
      await service.getAuditLogs(buildUser(), {});

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { subscriptionId: 'sub-1' },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(prisma.auditLog.count).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1' },
      });
      expect(prisma.auditLog.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            id: true,
            action: true,
            module: true,
            entityId: true,
            details: true,
            ipAddress: true,
            createdAt: true,
          }),
        }),
      );
    });

    it('applies no subscription filter for a global admin scope', async () => {
      scope.tenantWhere.mockReturnValue({});

      await service.getAuditLogs(buildUser({ role: RoleType.SAAS_ADMIN }), {});

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('filters by exact action, module and userId when provided', async () => {
      await service.getAuditLogs(buildUser(), {
        action: 'LOGIN',
        module: 'AUTH_USERS',
        userId: 'u9',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            subscriptionId: 'sub-1',
            action: 'LOGIN',
            module: 'AUTH_USERS',
            userId: 'u9',
          },
        }),
      );
    });

    it('omits every filter key that was not provided', async () => {
      await service.getAuditLogs(buildUser(), {});

      const where = (
        prisma.auditLog.findMany.mock.calls[0][0] as {
          where: Record<string, unknown>;
        }
      ).where;
      expect(Object.keys(where).sort()).toEqual(['subscriptionId']);
    });

    it('builds the createdAt range from from and to', async () => {
      const from = '2026-03-01T00:00:00.000Z';
      const to = '2026-03-31T23:59:59.000Z';

      await service.getAuditLogs(buildUser(), { from, to });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            subscriptionId: 'sub-1',
            createdAt: { gte: new Date(from), lte: new Date(to) },
          },
        }),
      );
    });

    it('defaults to page 1 with pageSize 20 and computes totalPages', async () => {
      const result = await service.getAuditLogs(buildUser(), {});

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.total).toBe(11);
      expect(result.totalPages).toBe(1);
    });

    it('clamps pageSize to 100 and page to a minimum of 1', async () => {
      await service.getAuditLogs(buildUser(), { page: 0, pageSize: 500 });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 100 }),
      );
    });

    it('computes skip and totalPages from the requested page', async () => {
      prisma.auditLog.count.mockResolvedValue(25);

      const result = await service.getAuditLogs(buildUser(), {
        page: 3,
        pageSize: 10,
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
      expect(result.page).toBe(3);
      expect(result.totalPages).toBe(3);
    });

    it('maps persisted rows to the listing contract, including system rows without user', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        buildAuditRow(),
        buildAuditRow({
          id: 'audit-2',
          action: 'LOGIN',
          details: 'manual entry',
          createdAt: new Date('2026-03-02T08:30:00.000Z'),
          user: null,
        }),
      ] as never);

      const result = await service.getAuditLogs(buildUser(), {});

      expect(result.data[0]).toEqual({
        id: 'audit-1',
        action: 'STATE_CHANGE',
        module: 'SALES_POS',
        entityId: 'sale-9',
        summary: null,
        ipAddress: '192.168.0.10',
        createdAt: '2026-03-01T12:00:00.000Z',
        user: { fullName: 'Ana Perez', displayName: null },
      });
      expect(result.data[1]).toEqual({
        id: 'audit-2',
        action: 'LOGIN',
        module: 'SALES_POS',
        entityId: 'sale-9',
        summary: 'manual entry',
        ipAddress: '192.168.0.10',
        createdAt: '2026-03-02T08:30:00.000Z',
        user: { fullName: '', displayName: null },
      });
    });
  });
});
