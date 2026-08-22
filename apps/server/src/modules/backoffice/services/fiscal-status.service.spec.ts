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

import { FiscalStatusService } from './fiscal-status.service';

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

describe('FiscalStatusService', () => {
  let prisma: MockProxy<PrismaClient>;
  let scope: {
    tenantWhere: jest.Mock;
    saleTenantWhere: jest.Mock;
    tenantUserIds: jest.Mock;
    userTenantWhere: jest.Mock;
  };
  let service: FiscalStatusService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest.fn().mockReturnValue({}),
      tenantUserIds: jest.fn(),
      userTenantWhere: jest.fn(),
    };
    service = new FiscalStatusService(prisma as never, scope as never);

    prisma.fiscalDocument.groupBy.mockResolvedValue([]);
    prisma.fiscalDocument.findMany.mockResolvedValue([]);
  });

  describe('getStatus', () => {
    it('passes the groupBy through with the tenant scope and no date filter', async () => {
      await service.getStatus(buildUser());

      expect(prisma.fiscalDocument.groupBy).toHaveBeenCalledWith({
        by: ['fiscalState'],
        where: { subscriptionId: 'sub-1' },
        _count: { _all: true },
      });
    });

    it('adds an issueDate gte filter when from is provided', async () => {
      await service.getStatus(buildUser(), '2026-01-01');

      expect(prisma.fiscalDocument.groupBy).toHaveBeenCalledWith({
        by: ['fiscalState'],
        where: {
          subscriptionId: 'sub-1',
          issueDate: { gte: new Date('2026-01-01') },
        },
        _count: { _all: true },
      });
    });

    it('maps grouped rows to counts sorted by count descending', async () => {
      prisma.fiscalDocument.groupBy.mockResolvedValue([
        { fiscalState: 'VALIDATED', _count: { _all: 3 } },
        { fiscalState: 'REJECTED', _count: { _all: 7 } },
        { fiscalState: 'CONTINGENCY', _count: { _all: 1 } },
      ] as never);

      const result = await service.getStatus(buildUser());

      expect(result.countsByState).toEqual([
        { fiscalState: 'REJECTED', count: 7 },
        { fiscalState: 'VALIDATED', count: 3 },
        { fiscalState: 'CONTINGENCY', count: 1 },
      ]);
    });

    it('returns an empty countsByState list when the groupBy is empty', async () => {
      const result = await service.getStatus(buildUser());

      expect(result.countsByState).toEqual([]);
    });

    it('queries recent rejected documents limited to 20 ordered by issueDate desc', async () => {
      const rows = [
        { id: 'fd-1', fiscalState: 'REJECTED', fullNumber: 'F1' },
      ];
      prisma.fiscalDocument.findMany.mockResolvedValue(rows as never);

      const result = await service.getStatus(buildUser());

      expect(prisma.fiscalDocument.findMany).toHaveBeenCalledWith({
        where: { subscriptionId: 'sub-1', fiscalState: 'REJECTED' },
        orderBy: { issueDate: 'desc' },
        take: 20,
        select: expect.objectContaining({ id: true }),
      });
      expect(result.recentRejected).toEqual(rows);
    });
  });
});