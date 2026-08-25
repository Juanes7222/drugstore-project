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
  SaasAdminLifecycleService,
} from './saas-admin-lifecycle.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import {
  ChangePlanBodySchema,
  CustomerPaymentsQuerySchema,
  ExtendTrialBodySchema,
  SuspendCustomerBodySchema,
} from '../dto/saas-admin-query.dto';

const DAY_MS = 24 * 60 * 60 * 1000;

const ACTOR = { id: 'admin-1', role: 'SAAS_ADMIN' };
const SUBSCRIPTION_ID = 'sub-1';
const CUSTOMER_ROW = { id: SUBSCRIPTION_ID, customerName: 'Farmacia Central' };

type SubscriptionRow = {
  id: string;
  planId: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
};

function buildSubscriptionRow(
  overrides: Partial<SubscriptionRow> = {},
): SubscriptionRow {
  return {
    id: SUBSCRIPTION_ID,
    planId: 'plan-1',
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEnd: new Date('2026-09-30T00:00:00.000Z'),
    ...overrides,
  };
}

describe('SaasAdminLifecycleService', () => {
  let prisma: MockProxy<PrismaClient>;
  let subscriptions: {
    suspend: ReturnType<typeof jest.fn>;
    reactivate: ReturnType<typeof jest.fn>;
    changePlan: ReturnType<typeof jest.fn>;
  };
  let overview: { getCustomer: ReturnType<typeof jest.fn> };
  let accessAudit: { recordCustomerAccess: ReturnType<typeof jest.fn> };
  let service: SaasAdminLifecycleService;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    subscriptions = {
      suspend: jest.fn().mockResolvedValue({}),
      reactivate: jest.fn().mockResolvedValue({}),
      changePlan: jest.fn().mockResolvedValue({}),
    };
    overview = {
      getCustomer: jest.fn().mockResolvedValue(CUSTOMER_ROW),
    };
    accessAudit = {
      recordCustomerAccess: jest.fn<(input: unknown) => Promise<void>>(),
    };
    accessAudit.recordCustomerAccess.mockResolvedValue(undefined);

    service = new SaasAdminLifecycleService(
      prisma as never,
      subscriptions as never,
      overview as never,
      accessAudit as never,
    );
  });

  async function expectConflict(promise: Promise<unknown>, errorCode: string) {
    const error = (await promise.catch((caught: unknown) => caught)) as
      | DomainException
      | undefined;
    expect(error).toBeInstanceOf(DomainException);
    expect(error?.errorCode).toBe(errorCode);
    expect(error?.getStatus()).toBe(409);
  }

  describe('suspend', () => {
    it('delegates to licensing for a non-suspended subscription and audits', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionRow({ status: 'ACTIVE' }) as never,
      );

      const result = await service.suspend(ACTOR, SUBSCRIPTION_ID, 'fraud review');

      expect(subscriptions.suspend).toHaveBeenCalledWith(SUBSCRIPTION_ID);
      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          actorUser: ACTOR,
          subscriptionId: SUBSCRIPTION_ID,
          endpoint: '/saas-admin/customers/sub-1/suspend',
          details: { reason: 'fraud review' },
        }),
      );
      expect(result).toBe(CUSTOMER_ROW);
    });

    it('is a no-op write on an already-SUSPENDED row (idempotent)', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionRow({ status: 'SUSPENDED' }) as never,
      );

      const result = await service.suspend(ACTOR, SUBSCRIPTION_ID);

      expect(subscriptions.suspend).not.toHaveBeenCalled();
      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledTimes(1);
      expect(result).toBe(CUSTOMER_ROW);
    });

    it('throws SUBSCRIPTION_NOT_FOUND for an unknown subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null as never);

      await expect(service.suspend(ACTOR, 'missing')).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_NOT_FOUND',
      });
      expect(subscriptions.suspend).not.toHaveBeenCalled();
    });
  });

  describe('reactivate', () => {
    it.each(['SUSPENDED', 'PAST_DUE'] as const)(
      'reactivates from %s through the licensing service',
      async (status) => {
        prisma.subscription.findUnique.mockResolvedValue(
          buildSubscriptionRow({ status }) as never,
        );

        const result = await service.reactivate(ACTOR, SUBSCRIPTION_ID);

        expect(subscriptions.reactivate).toHaveBeenCalledWith(SUBSCRIPTION_ID);
        expect(accessAudit.recordCustomerAccess).toHaveBeenCalledWith(
          expect.objectContaining({
            endpoint: '/saas-admin/customers/sub-1/reactivate',
          }),
        );
        expect(result).toBe(CUSTOMER_ROW);
      },
    );

    it.each(['ACTIVE', 'TRIAL', 'CANCELLED', 'EXPIRED'] as const)(
      'rejects reactivation from %s with 409',
      async (status) => {
        prisma.subscription.findUnique.mockResolvedValue(
          buildSubscriptionRow({ status }) as never,
        );

        await expectConflict(
          service.reactivate(ACTOR, SUBSCRIPTION_ID),
          'SUBSCRIPTION_CANNOT_REACTIVATE',
        );
        expect(subscriptions.reactivate).not.toHaveBeenCalled();
      },
    );

    it('throws SUBSCRIPTION_NOT_FOUND for an unknown subscription', async () => {
      prisma.subscription.findUnique.mockResolvedValue(null as never);

      await expect(service.reactivate(ACTOR, 'missing')).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_NOT_FOUND',
      });
    });
  });

  describe('changePlan', () => {
    it('resolves the plan by code and delegates to the licensing service', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionRow() as never,
      );
      prisma.plan.findUnique.mockResolvedValue({ id: 'plan-2' } as never);

      const result = await service.changePlan(ACTOR, SUBSCRIPTION_ID, {
        planCode: 'CERTIFICATE',
      });

      expect(prisma.plan.findUnique).toHaveBeenCalledWith({
        where: { code: 'CERTIFICATE' },
        select: { id: true },
      });
      expect(subscriptions.changePlan).toHaveBeenCalledWith(
        SUBSCRIPTION_ID,
        'plan-2',
      );
      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: '/saas-admin/customers/sub-1/change-plan',
          details: { planCode: 'CERTIFICATE' },
        }),
      );
      expect(result).toBe(CUSTOMER_ROW);
    });

    it('rejects an unknown plan code with 404 PLAN_NOT_FOUND', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionRow() as never,
      );
      prisma.plan.findUnique.mockResolvedValue(null as never);

      const error = (
        await service
          .changePlan(ACTOR, SUBSCRIPTION_ID, { planCode: 'NOPE' })
          .catch((caught: unknown) => caught)
      ) as DomainException | undefined;

      expect(error).toBeInstanceOf(DomainException);
      expect(error?.errorCode).toBe('PLAN_NOT_FOUND');
      expect(error?.getStatus()).toBe(404);
      expect(subscriptions.changePlan).not.toHaveBeenCalled();
    });

    it('skips the write when target plan equals the current plan (idempotent)', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionRow({ planId: 'plan-1' }) as never,
      );
      prisma.plan.findUnique.mockResolvedValue({ id: 'plan-1' } as never);

      await service.changePlan(ACTOR, SUBSCRIPTION_ID, { planCode: 'PROVIDER' });

      expect(subscriptions.changePlan).not.toHaveBeenCalled();
      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledTimes(1);
    });
  });

  describe('extendTrial', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-08-24T10:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('extends a running trial from its current end and moves the period end', async () => {
      const trialEndsAt = new Date('2026-08-29T10:00:00.000Z'); // now + 5d
      prisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionRow({
          status: 'TRIAL',
          trialEndsAt,
          currentPeriodEnd: trialEndsAt,
        }) as never,
      );

      const result = await service.extendTrial(ACTOR, SUBSCRIPTION_ID, 10);

      const { trialEndsAt: updatedEnd, currentPeriodEnd } = (
        prisma.subscription.update.mock.calls[0][0] as {
          data: { trialEndsAt: Date; currentPeriodEnd: Date };
        }
      ).data;
      expect(Math.round((updatedEnd.getTime() - trialEndsAt.getTime()) / DAY_MS)).toBe(10);
      expect(currentPeriodEnd.getTime()).toBe(updatedEnd.getTime());
      expect(accessAudit.recordCustomerAccess).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: '/saas-admin/customers/sub-1/extend-trial',
          details: { days: 10 },
        }),
      );
      expect(result).toBe(CUSTOMER_ROW);
    });

    it('grants full days from NOW when the trial end already passed', async () => {
      const trialEndsAt = new Date('2026-08-21T10:00:00.000Z'); // now - 3d, cron not yet run
      prisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionRow({
          status: 'TRIAL',
          trialEndsAt,
          currentPeriodEnd: trialEndsAt,
        }) as never,
      );

      await service.extendTrial(ACTOR, SUBSCRIPTION_ID, 7);

      const { trialEndsAt: updatedEnd } = (
        prisma.subscription.update.mock.calls[0][0] as {
          data: { trialEndsAt: Date };
        }
      ).data;
      const now = new Date('2026-08-24T10:00:00.000Z');
      expect(Math.round((updatedEnd.getTime() - now.getTime()) / DAY_MS)).toBe(7);
    });

    it('never shortens currentPeriodEnd below its existing value', async () => {
      const farPeriodEnd = new Date('2026-09-23T10:00:00.000Z'); // now + 30d
      prisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionRow({
          status: 'TRIAL',
          trialEndsAt: new Date('2026-08-21T10:00:00.000Z'),
          currentPeriodEnd: farPeriodEnd,
        }) as never,
      );

      await service.extendTrial(ACTOR, SUBSCRIPTION_ID, 7);

      const { currentPeriodEnd } = (
        prisma.subscription.update.mock.calls[0][0] as {
          data: { currentPeriodEnd: Date };
        }
      ).data;
      expect(currentPeriodEnd.getTime()).toBe(farPeriodEnd.getTime());
    });

    it('rejects non-TRIAL subscriptions with 409 SUBSCRIPTION_NOT_IN_TRIAL', async () => {
      prisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionRow({ status: 'ACTIVE' }) as never,
      );

      await expectConflict(
        service.extendTrial(ACTOR, SUBSCRIPTION_ID, 7),
        'SUBSCRIPTION_NOT_IN_TRIAL',
      );
      expect(prisma.subscription.update).not.toHaveBeenCalled();
    });
  });
});

describe('saas-admin lifecycle DTO schemas', () => {
  it('SuspendCustomerBodySchema bounds the optional reason', () => {
    expect(SuspendCustomerBodySchema.safeParse({}).success).toBe(true);
    expect(SuspendCustomerBodySchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(true);
    expect(SuspendCustomerBodySchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(SuspendCustomerBodySchema.safeParse({ reason: '   ' }).success).toBe(false);
  });

  it('ChangePlanBodySchema requires a planCode', () => {
    expect(ChangePlanBodySchema.parse({ planCode: 'PROVIDER' })).toEqual({
      planCode: 'PROVIDER',
    });
    expect(ChangePlanBodySchema.safeParse({}).success).toBe(false);
  });

  it('ExtendTrialBodySchema accepts whole days 1..90 only', () => {
    expect(ExtendTrialBodySchema.parse({ days: 1 })).toEqual({ days: 1 });
    expect(ExtendTrialBodySchema.parse({ days: '90' })).toEqual({ days: 90 });
    expect(ExtendTrialBodySchema.safeParse({ days: 0 }).success).toBe(false);
    expect(ExtendTrialBodySchema.safeParse({ days: 91 }).success).toBe(false);
    expect(ExtendTrialBodySchema.safeParse({ days: 7.5 }).success).toBe(false);
  });

  it('CustomerPaymentsQuerySchema accepts optional paging', () => {
    expect(CustomerPaymentsQuerySchema.parse({})).toEqual({});
    expect(CustomerPaymentsQuerySchema.parse({ page: '2', pageSize: '50' })).toEqual({
      page: 2,
      pageSize: 50,
    });
    expect(CustomerPaymentsQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(CustomerPaymentsQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});
