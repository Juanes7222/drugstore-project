import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SaasAdminSyncHealthService } from './saas-admin-sync-health.service';

type QueueGroup = {
  subscriptionId: string;
  _count?: number;
  _min?: { receivedAt: Date };
};

type OutcomeGroup = {
  subscriptionId: string;
  _count?: number;
  _max?: { createdAt: Date };
};

describe('SaasAdminSyncHealthService', () => {
  let prisma: MockProxy<PrismaClient>;
  let service: SaasAdminSyncHealthService;
  let pendingCounts: QueueGroup[];
  let oldestPending: QueueGroup[];
  let failureCounts: OutcomeGroup[];
  let lastSync: OutcomeGroup[];

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new SaasAdminSyncHealthService(prisma as never);

    pendingCounts = [];
    oldestPending = [];
    failureCounts = [];
    lastSync = [];

    // Two groupBy calls hit syncQueue (counts and oldest-pending); dispatch
    // on the presence of the _min selector in the call arguments.
    prisma.syncQueue.groupBy.mockImplementation(async (args?: {
      _min?: unknown;
    }) => ((args?._min ? oldestPending : pendingCounts) as never));

    // Likewise for syncOperationOutcome (failure counts and last-sync max).
    prisma.syncOperationOutcome.groupBy.mockImplementation(async (args?: {
      _max?: unknown;
    }) => ((args?._max ? lastSync : failureCounts) as never));

    prisma.subscription.findMany.mockResolvedValue([] as never);
  });

  function mockSubscriptions(names: Record<string, string>): void {
    prisma.subscription.findMany.mockResolvedValue(
      Object.entries(names).map(([id, customerName]) => ({
        id,
        customerName,
      })) as never,
    );
  }

  it('groups by the tenant metric definitions (PENDING queue rows, FAILED outcomes)', async () => {
    await service.getSyncHealth();

    expect(prisma.syncQueue.groupBy).toHaveBeenCalledWith({
      by: ['subscriptionId'],
      where: { status: 'PENDING' },
      _count: true,
    });
    expect(prisma.syncQueue.groupBy).toHaveBeenCalledWith({
      by: ['subscriptionId'],
      where: { status: 'PENDING' },
      _min: { receivedAt: true },
    });
    expect(prisma.syncOperationOutcome.groupBy).toHaveBeenCalledWith({
      by: ['subscriptionId'],
      where: { outcome: 'FAILED' },
      _count: true,
    });
    expect(prisma.syncOperationOutcome.groupBy).toHaveBeenCalledWith({
      by: ['subscriptionId'],
      _max: { createdAt: true },
    });
  });

  it('includes subscriptions with only pending backlog or only outcomes, resolving names', async () => {
    const oldest = new Date('2026-08-23T00:00:00.000Z');
    pendingCounts = [{ subscriptionId: 'sub-backlog', _count: 5 }];
    oldestPending = [{ subscriptionId: 'sub-backlog', _min: { receivedAt: oldest } }];
    lastSync = [
      { subscriptionId: 'sub-healthy', _max: { createdAt: new Date('2026-08-24T01:00:00.000Z') } },
    ];
    mockSubscriptions({ 'sub-backlog': 'Farmacia Backlog', 'sub-healthy': 'Farmacia Healthy' });

    const rows = await service.getSyncHealth();

    expect(prisma.subscription.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['sub-backlog', 'sub-healthy'] } },
      select: { id: true, customerName: true },
    });
    expect(rows).toEqual([
      {
        subscriptionId: 'sub-backlog',
        customerName: 'Farmacia Backlog',
        pendingOperations: 5,
        permanentFailures: 0,
        oldestPendingAt: oldest.toISOString(),
        lastSyncAt: null,
      },
      {
        subscriptionId: 'sub-healthy',
        customerName: 'Farmacia Healthy',
        pendingOperations: 0,
        permanentFailures: 0,
        oldestPendingAt: null,
        lastSyncAt: '2026-08-24T01:00:00.000Z',
      },
    ]);
  });

  it('orders worst first: failures desc, then pending desc, then oldest pending asc with nulls last', async () => {
    const old = new Date('2026-08-20T00:00:00.000Z');
    const older = new Date('2026-08-19T00:00:00.000Z');

    pendingCounts = [
      { subscriptionId: 'sub-pend-7', _count: 7 },
      { subscriptionId: 'sub-pend-2', _count: 2 },
      { subscriptionId: 'sub-tie-old', _count: 1 },
      { subscriptionId: 'sub-tie-newer', _count: 1 },
    ];
    oldestPending = [
      { subscriptionId: 'sub-pend-7', _min: { receivedAt: old } },
      { subscriptionId: 'sub-pend-2', _min: { receivedAt: old } },
      { subscriptionId: 'sub-tie-old', _min: { receivedAt: older } },
      { subscriptionId: 'sub-tie-newer', _min: { receivedAt: old } },
    ];
    failureCounts = [
      { subscriptionId: 'sub-fail', _count: 3 },
      { subscriptionId: 'sub-pend-7', _count: 1 },
    ];
    lastSync = [{ subscriptionId: 'sub-clean', _max: { createdAt: new Date('2026-08-24T00:00:00.000Z') } }];
    mockSubscriptions({});

    const ids = (await service.getSyncHealth()).map((row) => row.subscriptionId);

    // sub-fail: most permanent failures; sub-pend-7 outranks the zero-failure
    // rows; among those, deeper backlog first (pend-2 has 7 pending); then the
    // equal-backlog tie broken by the stalest pending op; finally the
    // activity-only tenant with no pending ops (null oldestPendingAt last).
    expect(ids).toEqual([
      'sub-fail',
      'sub-pend-7',
      'sub-pend-2',
      'sub-tie-old',
      'sub-tie-newer',
      'sub-clean',
    ]);
  });

  it('caps results at 100 rows', async () => {
    lastSync = Array.from({ length: 150 }, (_, i) => ({
      subscriptionId: `sub-${String(i).padStart(3, '0')}`,
      _max: { createdAt: new Date('2026-08-24T00:00:00.000Z') },
    }));
    mockSubscriptions({});

    const rows = await service.getSyncHealth();

    expect(rows).toHaveLength(100);
  });

  it('returns an empty array when no subscription has any sync activity', async () => {
    const rows = await service.getSyncHealth();

    expect(rows).toEqual([]);
    expect(prisma.subscription.findMany).not.toHaveBeenCalled();
  });
});
