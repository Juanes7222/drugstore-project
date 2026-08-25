import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SaasAdminAccessAuditService } from './saas-admin-access-audit.service';

type EventFixture = {
  id: string;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  details: string | null;
  userId: string | null;
  user: { email: string } | null;
  subscriptionId: string | null;
  ipAddress: string | null;
  createdAt: Date;
};

function buildEvent(overrides: Partial<EventFixture> = {}): EventFixture {
  return {
    id: 'event-1',
    action: 'ACCESS',
    module: 'REPORTS',
    entityType: 'Subscription',
    entityId: 'sub-1',
    details: JSON.stringify({ endpoint: '/saas-admin/customers/sub-1/dashboard' }),
    userId: 'admin-1',
    user: { email: 'platform@example.com' },
    subscriptionId: 'sub-1',
    ipAddress: '203.0.113.10',
    createdAt: new Date('2026-08-24T08:15:00.000Z'),
    ...overrides,
  };
}

describe('SaasAdminAccessAuditService', () => {
  let prisma: MockProxy<PrismaClient>;
  let service: SaasAdminAccessAuditService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new SaasAdminAccessAuditService(prisma as never);

    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.subscription.findMany.mockResolvedValue([]);
  });

  describe('listAccessEvents', () => {
    it('reads this service own write conventions (ACCESS / REPORTS / Subscription or CsvExport)', async () => {
      const expectedWhere = {
        action: 'ACCESS',
        module: 'REPORTS',
        entityType: { in: ['Subscription', 'CsvExport'] },
      };

      await service.listAccessEvents({});

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expectedWhere }),
      );
      expect(prisma.auditLog.count).toHaveBeenCalledWith({
        where: expectedWhere,
      });
    });

    it('orders newest first with default pagination of page 1, pageSize 20', async () => {
      prisma.auditLog.count.mockResolvedValue(21);

      const result = await service.listAccessEvents({});

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(result.totalPages).toBe(2);
    });

    it('computes skip from the clamped pageSize and clamps out-of-range values', async () => {
      await service.listAccessEvents({ page: 2, pageSize: 500 });

      // pageSize clamps to 100, so page 2 starts at skip (2-1)*100.
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 100 }),
      );
    });

    it('maps audit rows to result rows including nullable actor, ip and summary', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        buildEvent(),
        buildEvent({
          id: 'event-2',
          userId: null,
          user: null,
          subscriptionId: null,
          ipAddress: null,
          details: null,
        }),
      ] as never);
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', customerName: 'Farmacia Central' },
      ] as never);

      const result = await service.listAccessEvents({});

      const first = result.data[0];
      expect(first).toEqual({
        id: 'event-1',
        actorEmail: 'platform@example.com',
        action: 'ACCESS',
        subscriptionId: 'sub-1',
        customerName: 'Farmacia Central',
        summary: JSON.stringify({
          endpoint: '/saas-admin/customers/sub-1/dashboard',
        }),
        ipAddress: '203.0.113.10',
        createdAt: '2026-08-24T08:15:00.000Z',
      });
      expect(result.data[1]?.actorEmail).toBeNull();
      expect(result.data[1]?.customerName).toBeNull();
      expect(result.data[1]?.ipAddress).toBeNull();
      expect(result.data[1]?.summary).toBeNull();
      expect(result.total).toBe(0);
    });

    it('resolves customer names for the page subscriptions in one batched lookup', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        buildEvent({ id: 'e-1', subscriptionId: 'sub-1' }),
        buildEvent({ id: 'e-2', subscriptionId: 'sub-1' }),
        buildEvent({ id: 'e-3', subscriptionId: 'sub-2' }),
      ] as never);
      prisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-1', customerName: 'Farmacia Central' },
        { id: 'sub-2', customerName: 'Drogueria Norte' },
      ] as never);

      await service.listAccessEvents({ page: 1, pageSize: 20 });

      expect(prisma.subscription.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.subscription.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['sub-1', 'sub-2'] } },
        select: { id: true, customerName: true },
      });
    });

    it('skips the subscription lookup entirely when the page has no subscription ids', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        buildEvent({ subscriptionId: null }),
      ] as never);

      const result = await service.listAccessEvents({});

      expect(prisma.subscription.findMany).not.toHaveBeenCalled();
      expect(result.data[0]?.customerName).toBeNull();
    });

    it('maps an unknown subscription id to a null customer name without failing', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        buildEvent({ subscriptionId: 'deleted-sub' }),
      ] as never);
      prisma.subscription.findMany.mockResolvedValue([] as never);

      const result = await service.listAccessEvents({});

      expect(result.data[0]?.customerName).toBeNull();
    });
  });

  describe('recordCustomerAccess', () => {
    it('writes an ACCESS audit row bound to the accessed subscription and actor', async () => {
      await service.recordCustomerAccess({
        actorUser: { id: 'admin-1', role: 'SAAS_ADMIN' },
        subscriptionId: 'sub-1',
        endpoint: '/saas-admin/customers/sub-1/dashboard',
        ipAddress: '203.0.113.10',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
      const data = (
        prisma.auditLog.create.mock.calls[0][0] as {
          data: Record<string, unknown>;
        }
      ).data;
      expect(data.action).toBe('ACCESS');
      expect(data.module).toBe('REPORTS');
      expect(data.entityType).toBe('Subscription');
      expect(data.entityId).toBe('sub-1');
      expect(data.userId).toBe('admin-1');
      expect(data.userRole).toBe('SAAS_ADMIN');
      expect(data.subscriptionId).toBe('sub-1');
      expect(data.ipAddress).toBe('203.0.113.10');
      expect(typeof data.id).toBe('string');
      expect(data.details).toBe(
        JSON.stringify({
          endpoint: '/saas-admin/customers/sub-1/dashboard',
        }),
      );
    });

    it('stores a null ip address when none is provided', async () => {
      await service.recordCustomerAccess({
        actorUser: { id: 'admin-1', role: 'SAAS_ADMIN' },
        subscriptionId: 'sub-1',
        endpoint: '/saas-admin/customers/sub-1/users',
      });

      const data = (
        prisma.auditLog.create.mock.calls[0][0] as {
          data: { ipAddress: string | null };
        }
      ).data;
      expect(data.ipAddress).toBeNull();
    });

    it('swallows write failures so auditing never breaks the request', async () => {
      prisma.auditLog.create.mockRejectedValue(new Error('audit table down'));

      await expect(
        service.recordCustomerAccess({
          actorUser: { id: 'admin-1', role: 'SAAS_ADMIN' },
          subscriptionId: 'sub-1',
          endpoint: '/saas-admin/customers/sub-1/dashboard',
        }),
      ).resolves.toBeUndefined();
    });
  });
});