import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SaasAdminAtRiskService } from './saas-admin-at-risk.service';
import { AtRiskQuerySchema } from '../dto/saas-admin-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-08-24T10:00:00.000Z');

type CandidateFixture = {
  id: string;
  customerName: string;
  customerEmail: string | null;
  status: string;
  _count: { workstationActivations: number };
};

function buildCandidate(
  overrides: Partial<CandidateFixture> = {},
): CandidateFixture {
  return {
    id: 'sub-1',
    customerName: 'Farmacia Central',
    customerEmail: 'owner@central.com',
    status: 'ACTIVE',
    _count: { workstationActivations: 2 },
    ...overrides,
  };
}

describe('SaasAdminAtRiskService', () => {
  let prisma: MockProxy<PrismaClient>;
  let service: SaasAdminAtRiskService;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);

    prisma = mockDeep<PrismaClient>();
    // withTenant executes the callback with the mock itself (no real tenant transaction).
    (prisma.withTenant as jest.Mock).mockImplementation(
      async (_subscriptionId: string, fn: (tx: unknown) => Promise<unknown>) =>
        fn(prisma),
    );
    service = new SaasAdminAtRiskService(prisma as never);

    prisma.subscription.findMany.mockResolvedValue([]);
    prisma.sale.findFirst.mockResolvedValue(null as never);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Per-subscription latest-sale answers keyed by subscription id. */
  function mockLatestSales(sales: Record<string, Date | null>): void {
    prisma.sale.findFirst.mockImplementation(
      async (args?: { where?: { cashShift?: { subscriptionId?: string } } }) => {
        const confirmedAt =
          sales[args?.where?.cashShift?.subscriptionId ?? ''] ?? null;
        // findFirst returns the row, not the bare column.
        return confirmedAt ? { confirmedAt } : null;
      },
    );
  }

  it('only considers ACTIVE and TRIAL subscriptions', async () => {
    await service.getAtRiskCustomers(14);

    expect(prisma.subscription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      }),
    );
  });

  it('sorts never-sold first, then stalest sale first', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      buildCandidate({ id: 'sub-recent-20d' }),
      buildCandidate({
        id: 'sub-never',
        customerName: 'Drogueria Norte',
        customerEmail: null,
        status: 'TRIAL',
        _count: { workstationActivations: 0 },
      }),
      buildCandidate({ id: 'sub-stale-60d', status: 'PAST_DUE' }),
    ] as never);
    mockLatestSales({
      'sub-recent-20d': new Date(NOW.getTime() - 20 * DAY_MS),
      'sub-never': null,
      'sub-stale-60d': new Date(NOW.getTime() - 60 * DAY_MS),
    });

    const rows = await service.getAtRiskCustomers(14);

    expect(rows.map((row) => row.subscriptionId)).toEqual([
      'sub-never',
      'sub-stale-60d',
      'sub-recent-20d',
    ]);
    expect(rows[0]).toEqual({
      subscriptionId: 'sub-never',
      customerName: 'Drogueria Norte',
      customerEmail: null,
      status: 'TRIAL',
      lastSaleAt: null,
      workstationActivations: 0,
    });
    expect(rows[1]?.lastSaleAt).toBe(
      new Date(NOW.getTime() - 60 * DAY_MS).toISOString(),
    );
  });

  it('applies the window strictly: a sale at the cutoff keeps the tenant out', async () => {
    const cutoff = new Date(NOW);
    cutoff.setDate(cutoff.getDate() - 14); // exactly how the service builds it
    prisma.subscription.findMany.mockResolvedValue([
      buildCandidate({ id: 'sub-at-cutoff' }),
      buildCandidate({ id: 'sub-15d' }),
      buildCandidate({ id: 'sub-13d' }),
    ] as never);
    mockLatestSales({
      'sub-at-cutoff': cutoff, // >= cutoff → not at risk
      'sub-15d': new Date(NOW.getTime() - 15 * DAY_MS), // strictly older → at risk
      'sub-13d': new Date(NOW.getTime() - 13 * DAY_MS), // inside window → healthy
    });

    const rows = await service.getAtRiskCustomers(14);

    expect(rows.map((row) => row.subscriptionId)).toEqual(['sub-15d']);
  });

  it('runs each latest-sale lookup inside that subscription RLS scope', async () => {
    prisma.subscription.findMany.mockResolvedValue([
      buildCandidate({ id: 'sub-a' }),
      buildCandidate({ id: 'sub-b' }),
    ] as never);
    mockLatestSales({ 'sub-a': null, 'sub-b': null });

    await service.getAtRiskCustomers(30);

    expect(prisma.withTenant).toHaveBeenCalledWith('sub-a', expect.any(Function));
    expect(prisma.withTenant).toHaveBeenCalledWith('sub-b', expect.any(Function));
    expect(prisma.sale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          operationalState: 'CONFIRMED',
          confirmedAt: { not: null },
        }),
        orderBy: { confirmedAt: 'desc' },
      }),
    );
  });

  it('caps results at 100 rows', async () => {
    const candidates = Array.from({ length: 120 }, (_, i) =>
      buildCandidate({ id: `sub-${i}` }),
    );
    prisma.subscription.findMany.mockResolvedValue(candidates as never);
    mockLatestSales({});

    const rows = await service.getAtRiskCustomers(14);

    expect(rows).toHaveLength(100);
  });
});

describe('AtRiskQuerySchema', () => {
  it('defaults inactiveDays to 14 and accepts the 7..90 range', () => {
    expect(AtRiskQuerySchema.parse({})).toEqual({ inactiveDays: 14 });
    expect(AtRiskQuerySchema.parse({ inactiveDays: '7' })).toEqual({
      inactiveDays: 7,
    });
    expect(
      AtRiskQuerySchema.safeParse({ inactiveDays: 90 }).success,
    ).toBe(true);
  });

  it('rejects out-of-bounds and non-integer windows', () => {
    expect(AtRiskQuerySchema.safeParse({ inactiveDays: 6 }).success).toBe(false);
    expect(AtRiskQuerySchema.safeParse({ inactiveDays: 91 }).success).toBe(false);
    expect(AtRiskQuerySchema.safeParse({ inactiveDays: 14.5 }).success).toBe(false);
  });
});
