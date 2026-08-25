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

import {
  SaasAdminOverviewService,
  type SaasAdminTrialEndingRow,
} from './saas-admin-overview.service';
import { SubscriptionStatus } from '@pharmacy/database';

const DAY_MS = 24 * 60 * 60 * 1000;

type TrialFixture = {
  id: string;
  customerName: string;
  customerEmail: string | null;
  trialEndsAt: Date | null;
  plan: { code: string; name: string };
};

function buildTrial(overrides: Partial<TrialFixture> = {}): TrialFixture {
  return {
    id: 'sub-1',
    customerName: 'Farmacia Central',
    customerEmail: 'owner@central.com',
    trialEndsAt: new Date('2026-09-01T12:00:00.000Z'),
    plan: { code: 'PRO', name: 'Pro' },
    ...overrides,
  };
}

describe('SaasAdminOverviewService', () => {
  let prisma: MockProxy<PrismaClient>;
  let service: SaasAdminOverviewService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new SaasAdminOverviewService(prisma as never);

    prisma.subscription.findMany.mockResolvedValue([]);
  });

  describe('getTrialsEnding', () => {
    it('queries only TRIAL subscriptions ordered by soonest trial end first', async () => {
      await service.getTrialsEnding(14);

      expect(prisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: SubscriptionStatus.TRIAL,
          }),
          orderBy: { trialEndsAt: 'asc' },
        }),
      );
    });

    it('windows trialEndsAt between now and now + days, upper bound inclusive', async () => {
      jest.useFakeTimers();
      try {
        jest.setSystemTime(new Date('2026-08-24T10:00:00.000Z'));

        await service.getTrialsEnding(14);

        const { gte, lte } = (
          prisma.subscription.findMany.mock.calls[0][0] as {
            where: { trialEndsAt: { gte: Date; lte: Date } };
          }
        ).where.trialEndsAt;

        // Lower bound is "now"; upper bound is calendar +days (setDate), so
        // it may deviate from a plain ms addition across DST transitions.
        expect(gte.getTime()).toBe(new Date('2026-08-24T10:00:00.000Z').getTime());
        const lowerToUpperDays =
          (lte.getTime() - gte.getTime()) / DAY_MS;
        expect(Math.round(lowerToUpperDays)).toBe(14);
      } finally {
        jest.useRealTimers();
      }
    });

    it('honors an arbitrary caller-supplied day count within the validated range', async () => {
      jest.useFakeTimers();
      try {
        // The DTO clamps/rejects days before the service sees them; here 45
        // must flow through to both window and response untouched.
        jest.setSystemTime(new Date('2026-08-24T10:00:00.000Z'));

        const result = await service.getTrialsEnding(45);

        const { gte, lte } = (
          prisma.subscription.findMany.mock.calls[0][0] as {
            where: { trialEndsAt: { gte: Date; lte: Date } };
          }
        ).where.trialEndsAt;
        expect(Math.round((lte.getTime() - gte.getTime()) / DAY_MS)).toBe(45);
        expect(result.days).toBe(45);
      } finally {
        jest.useRealTimers();
      }
    });

    it('maps rows to subscriptionId/customerName/plan with ISO trial end dates', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        buildTrial({ id: 'sub-a' }),
        buildTrial({
          id: 'sub-b',
          customerName: 'Drogueria Norte',
          customerEmail: null,
          trialEndsAt: new Date('2026-08-30T00:00:00.000Z'),
          plan: { code: 'BASIC', name: 'Basic' },
        }),
      ] as never);

      const result = await service.getTrialsEnding(7);

      const first = result.trials[0] as SaasAdminTrialEndingRow;
      expect(result.days).toBe(7);
      expect(first).toEqual({
        subscriptionId: 'sub-a',
        customerName: 'Farmacia Central',
        customerEmail: 'owner@central.com',
        trialEndsAt: '2026-09-01T12:00:00.000Z',
        plan: { code: 'PRO', name: 'Pro' },
      });
      expect(result.trials[1]?.customerEmail).toBeNull();
      expect(result.trials[1]?.trialEndsAt).toBe('2026-08-30T00:00:00.000Z');
    });

    it('drops rows whose nullable trialEndsAt came back null instead of emitting invalid dates', async () => {
      prisma.subscription.findMany.mockResolvedValue([
        buildTrial({ id: 'sub-null', trialEndsAt: null }),
        buildTrial({ id: 'sub-valid' }),
      ] as never);

      const result = await service.getTrialsEnding(14);

      expect(result.trials.map((trial) => trial.subscriptionId)).toEqual([
        'sub-valid',
      ]);
    });

    it('returns an empty trials list when nothing ends in the window', async () => {
      const result = await service.getTrialsEnding(3);

      expect(result.trials).toEqual([]);
      expect(result.days).toBe(3);
    });
  });
});
