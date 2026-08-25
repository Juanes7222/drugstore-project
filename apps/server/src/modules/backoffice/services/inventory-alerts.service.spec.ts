import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
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

import { InventoryAlertsService } from './inventory-alerts.service';

const FIXED_NOW = new Date('2026-03-01T12:00:00.000Z');

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

describe('InventoryAlertsService', () => {
  let prisma: MockProxy<PrismaClient>;
  let scope: {
    tenantWhere: jest.Mock;
    saleTenantWhere: jest.Mock;
    tenantUserIds: jest.Mock;
    userTenantWhere: jest.Mock;
  };
  let service: InventoryAlertsService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(FIXED_NOW);

    prisma = mockDeep<PrismaClient>();
    scope = {
      tenantWhere: jest.fn().mockReturnValue({ subscriptionId: 'sub-1' }),
      saleTenantWhere: jest.fn().mockReturnValue({}),
      tenantUserIds: jest.fn(),
      userTenantWhere: jest.fn(),
    };
    service = new InventoryAlertsService(prisma as never, scope as never);

    prisma.inventoryAdjustmentDocument.findMany.mockResolvedValue([]);
    prisma.lot.findMany.mockResolvedValue([]);
    prisma.product.findMany.mockResolvedValue([]);
    prisma.lot.groupBy.mockResolvedValue([]);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('getAlerts', () => {
    it('queries pending adjustments that were submitted but neither approved nor rejected', async () => {
      await service.getAlerts(buildUser());

      expect(
        prisma.inventoryAdjustmentDocument.findMany,
      ).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-1',
          submittedForApprovalAt: { not: null },
          approvedAt: null,
          rejectedAt: null,
        },
        orderBy: { submittedForApprovalAt: 'asc' },
        take: 100,
        select: expect.objectContaining({ id: true }),
      });
    });

    it('returns the pending adjustment rows as-is', async () => {
      const rows = [
        { id: 'adj-1', sequentialNumber: 'A-1', reason: 'damage' },
      ];
      prisma.inventoryAdjustmentDocument.findMany.mockResolvedValue(
        rows as never,
      );

      const result = await service.getAlerts(buildUser());

      expect(result.pendingAdjustments).toEqual(rows);
    });

    it('queries expiring lots inside the 90-day window with stock remaining', async () => {
      await service.getAlerts(buildUser());

      const expiringCall = (prisma.lot.findMany as jest.Mock).mock
        .calls[0][0];
      expect(expiringCall.where).toEqual({
        currentStock: { gt: 0 },
        expirationDate: {
          gte: FIXED_NOW,
          lte: new Date('2026-05-30T12:00:00.000Z'),
        },
        product: { subscriptionId: 'sub-1' },
      });
      expect(expiringCall.orderBy).toEqual({ expirationDate: 'asc' });
      expect(expiringCall.take).toBe(100);
    });

    it('queries already expired lots strictly before now with stock remaining', async () => {
      await service.getAlerts(buildUser());

      const expiredCall = (prisma.lot.findMany as jest.Mock).mock
        .calls[1][0];
      expect(expiredCall.where).toEqual({
        currentStock: { gt: 0 },
        expirationDate: { lt: FIXED_NOW },
        product: { subscriptionId: 'sub-1' },
      });
    });

    it('flags products whose active lot stock sum is below minimumStock', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', commercialName: 'Acetaminofen', minimumStock: 10 },
        { id: 'p2', commercialName: 'Ibuprofen', minimumStock: 5 },
      ] as never);
      prisma.lot.groupBy.mockResolvedValue([
        { productId: 'p1', _sum: { currentStock: 6 } },
        { productId: 'p2', _sum: { currentStock: 5 } },
      ] as never);

      const result = await service.getAlerts(buildUser());

      expect(prisma.lot.groupBy).toHaveBeenCalledWith({
        by: ['productId'],
        where: { state: 'ACTIVE', product: { subscriptionId: 'sub-1' } },
        _sum: { currentStock: true },
      });
      expect(result.lowStock).toEqual([
        {
          productId: 'p1',
          commercialName: 'Acetaminofen',
          minimumStock: 10,
          currentStock: 6,
        },
      ]);
    });

    it('treats a product with no lot stock rows as zero stock', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p3', commercialName: 'Vitamina C', minimumStock: 8 },
      ] as never);
      prisma.lot.groupBy.mockResolvedValue([]);

      const result = await service.getAlerts(buildUser());

      expect(result.lowStock).toEqual([
        {
          productId: 'p3',
          commercialName: 'Vitamina C',
          minimumStock: 8,
          currentStock: 0,
        },
      ]);
    });

    it('sorts low-stock products by stock ratio ascending', async () => {
      prisma.product.findMany.mockResolvedValue([
        { id: 'p1', commercialName: 'A', minimumStock: 100 },
        { id: 'p2', commercialName: 'B', minimumStock: 100 },
        { id: 'p3', commercialName: 'C', minimumStock: 100 },
      ] as never);
      prisma.lot.groupBy.mockResolvedValue([
        { productId: 'p1', _sum: { currentStock: 80 } },
        { productId: 'p2', _sum: { currentStock: 20 } },
        { productId: 'p3', _sum: { currentStock: 50 } },
      ] as never);

      const result = await service.getAlerts(buildUser());

      expect(result.lowStock.map((p) => p.productId)).toEqual([
        'p2',
        'p3',
        'p1',
      ]);
    });
  });
});
