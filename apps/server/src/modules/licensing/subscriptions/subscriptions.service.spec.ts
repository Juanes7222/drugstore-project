// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
    $on = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { SubscriptionsService } from './subscriptions.service';
import { PlansService } from '../plans/plans.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import type { CreateSubscriptionDto, UpdateSubscriptionDto, RecordPaymentDto } from './dto/subscription.dto';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildPlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'plan-uuid-1',
    code: 'PLAN_PRO',
    name: 'Plan Pro',
    description: 'Professional plan',
    pricingModel: 'FLAT' as const,
    basePriceCents: 50000,
    currency: 'COP',
    billingPeriod: 'MONTHLY' as const,
    maxLocations: 5,
    maxWorkstationsPerLocation: 3,
    includedWorkstations: 3,
    extraWorkstationPriceCents: 10000,
    features: ['feature-a', 'feature-b'],
    displayOrder: 1,
    isActive: true,
    isPublic: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function buildSubscription(overrides: Partial<Record<string, unknown>> = {}) {
  const plan = buildPlan();
  return {
    id: 'sub-uuid-1',
    planId: plan.id,
    plan,
    customerName: 'Test Customer',
    customerTaxId: '900123456',
    customerEmail: 'customer@example.com',
    customerPhone: '+571234567890',
    customerAddress: 'Calle 123',
    status: 'ACTIVE' as const,
    currentPeriodStart: new Date('2026-06-01'),
    currentPeriodEnd: new Date('2026-07-01'),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    paymentMethod: 'credit_card',
    paymentReference: null,
    lastPaymentAt: null,
    nextPaymentDueAt: null,
    gracePeriodDays: 7,
    locations: [],
    workstationActivations: [],
    activationCodes: [],
    paymentHistory: [],
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    ...overrides,
  };
}

function buildActivationCode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'code-uuid-1',
    subscriptionId: 'sub-uuid-1',
    locationId: null,
    code: 'ABCD-EFGH-IJKL-MNOP5',
    type: 'SUBSCRIPTION' as const,
    status: 'UNUSED' as const,
    usedAt: null,
    usedByActivationId: null,
    usedByActivation: null,
    expiresAt: new Date('2027-06-01'),
    createdAt: new Date('2026-06-01'),
    ...overrides,
  };
}

function buildPaymentHistory(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'payment-uuid-1',
    subscriptionId: 'sub-uuid-1',
    amountCents: 50000,
    currency: 'COP',
    paymentMethod: 'Bank transfer',
    paymentReference: 'REF-001',
    notes: 'Payment received',
    recordedAt: new Date('2026-06-15'),
    recordedById: 'admin-uuid-1',
    createdAt: new Date('2026-06-15'),
    ...overrides,
  };
}

function buildWorkstationActivation(overrides: Partial<Record<string, unknown>> = {}) {
  const location = buildLocation();
  return {
    id: 'activation-uuid-1',
    subscriptionId: 'sub-uuid-1',
    locationId: location.id,
    location,
    hardwareFingerprint: 'fp-unique-abc123',
    workstationName: 'WS-001',
    activationCodeId: 'code-uuid-1',
    activationCode: null,
    isActive: true,
    activatedAt: new Date('2026-06-01'),
    revokedAt: null,
    revokedReason: null,
    lastCheckInAt: null,
    lastCheckInIp: null,
    initialActivationIp: '192.168.1.10',
    checkInCount: 0,
    licenseCheckIns: [],
    fraudAlerts: [],
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    ...overrides,
  };
}

function buildLocation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'loc-uuid-1',
    subscriptionId: 'sub-uuid-1',
    name: 'Main Store',
    address: 'Av. Siempre Viva 742',
    city: 'Bogotá',
    region: 'Cundinamarca',
    country: 'CO',
    taxId: null,
    phone: null,
    email: null,
    isActive: true,
    latitude: null,
    longitude: null,
    notes: null,
    workstationActivations: [],
    activationCodes: [],
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubscriptionsService', () => {
  let service: SubscriptionsService;
  let mockPrisma: DeepMockProxy<PrismaClient>;
  let mockPlansService: { findById: jest.Mock };

  beforeEach(() => {
    mockPrisma = mockDeep<PrismaClient>();
    mockPlansService = { findById: jest.fn() };
    service = new SubscriptionsService(mockPrisma as any, mockPlansService as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    const createDto: CreateSubscriptionDto = {
      planId: 'plan-uuid-1',
      customerName: 'Test Customer',
      customerTaxId: '900123456',
      customerEmail: 'customer@example.com',
      customerPhone: '+571234567890',
      customerAddress: 'Calle 123',
      status: 'ACTIVE',
      paymentMethod: 'credit_card',
      gracePeriodDays: 7,
    };

    it('creates subscription with active plan and generates activation code', async () => {
      const plan = buildPlan({ isActive: true });
      const subscription = buildSubscription({ plan });
      mockPlansService.findById.mockResolvedValue(plan);
      mockPrisma.subscription.create.mockResolvedValue(subscription);
      mockPrisma.activationCode.create.mockResolvedValue(buildActivationCode());

      const result = await service.create(createDto);

      expect(mockPlansService.findById).toHaveBeenCalledWith('plan-uuid-1');
      expect(mockPrisma.subscription.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            planId: 'plan-uuid-1',
            customerName: 'Test Customer',
            customerTaxId: '900123456',
            customerEmail: 'customer@example.com',
            customerPhone: '+571234567890',
          }),
        }),
      );
      expect(mockPrisma.activationCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: expect.any(String),
            type: 'SUBSCRIPTION',
            status: 'UNUSED',
          }),
        }),
      );
      expect(result).toEqual(subscription);
    });

    it('throws PLAN_NOT_ACTIVE when plan is inactive', async () => {
      const plan = buildPlan({ isActive: false });
      mockPlansService.findById.mockResolvedValue(plan);

      await expect(service.create(createDto)).rejects.toThrow(DomainException);
      await expect(service.create(createDto)).rejects.toMatchObject({
        errorCode: 'PLAN_NOT_ACTIVE',
      });
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });

    it('throws PLAN_NOT_FOUND when plan does not exist', async () => {
      mockPlansService.findById.mockRejectedValue(
        new DomainException('PLAN_NOT_FOUND', 'Plan not found', 404),
      );

      await expect(service.create(createDto)).rejects.toThrow(DomainException);
      await expect(service.create(createDto)).rejects.toMatchObject({
        errorCode: 'PLAN_NOT_FOUND',
      });
      expect(mockPrisma.subscription.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // findAll
  // -----------------------------------------------------------------------
  describe('findAll', () => {
    it('returns subscriptions with plan included, ordered by creation date', async () => {
      const subscriptions = [
        buildSubscription({ id: 'sub-1' }),
        buildSubscription({ id: 'sub-2' }),
      ];
      mockPrisma.subscription.findMany.mockResolvedValue(subscriptions);

      const result = await service.findAll();

      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith({
        where: {},
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual(subscriptions);
    });

    it('filters by status when provided', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      await service.findAll({ status: 'ACTIVE' });

      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'ACTIVE' },
        }),
      );
    });

    it('filters by customerTaxId when provided', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      await service.findAll({ customerTaxId: '900123456' });

      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerTaxId: '900123456' },
        }),
      );
    });

    it('filters by customerEmail when provided', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([]);

      await service.findAll({ customerEmail: 'test@example.com' });

      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { customerEmail: 'test@example.com' },
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // findById
  // -----------------------------------------------------------------------
  describe('findById', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';

    it('returns subscription with all includes', async () => {
      const subscription = buildSubscription({
        locations: [buildLocation()],
        workstationActivations: [buildWorkstationActivation()],
        activationCodes: [buildActivationCode()],
        paymentHistory: [buildPaymentHistory()],
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.findById(SUBSCRIPTION_ID);

      expect(mockPrisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { id: SUBSCRIPTION_ID },
        include: {
          plan: true,
          locations: { where: { isActive: true } },
          workstationActivations: { include: { location: true } },
          activationCodes: true,
          paymentHistory: { orderBy: { recordedAt: 'desc' }, take: 20 },
        },
      });
      expect(result).toEqual(subscription);
    });

    it('throws SUBSCRIPTION_NOT_FOUND when subscription does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(service.findById(SUBSCRIPTION_ID)).rejects.toThrow(DomainException);
      await expect(service.findById(SUBSCRIPTION_ID)).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_NOT_FOUND',
      });
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';

    it('updates subscription fields when valid DTO is provided', async () => {
      const existing = buildSubscription();
      const updated = buildSubscription({
        customerName: 'Updated Name',
        customerPhone: '+570000000000',
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(existing);
      mockPrisma.subscription.update.mockResolvedValue(updated);

      const dto: UpdateSubscriptionDto = {
        customerName: 'Updated Name',
        customerPhone: '+570000000000',
      };
      const result = await service.update(SUBSCRIPTION_ID, dto);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUBSCRIPTION_ID },
        data: {
          customerName: 'Updated Name',
          customerPhone: '+570000000000',
        },
        include: { plan: true },
      });
      expect(result).toEqual(updated);
    });

    it('validates new planId when provided', async () => {
      const existing = buildSubscription();
      const newPlan = buildPlan({ id: 'plan-uuid-2', isActive: true });
      const updated = buildSubscription({ planId: 'plan-uuid-2', plan: newPlan });
      mockPrisma.subscription.findUnique.mockResolvedValue(existing);
      mockPlansService.findById.mockResolvedValue(newPlan);
      mockPrisma.subscription.update.mockResolvedValue(updated);

      const dto: UpdateSubscriptionDto = { planId: 'plan-uuid-2' };
      const result = await service.update(SUBSCRIPTION_ID, dto);

      expect(mockPlansService.findById).toHaveBeenCalledWith('plan-uuid-2');
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ planId: 'plan-uuid-2' }),
        }),
      );
      expect(result).toEqual(updated);
    });

    it('throws PLAN_NOT_ACTIVE when new plan is inactive', async () => {
      const existing = buildSubscription();
      const inactivePlan = buildPlan({ id: 'plan-uuid-2', isActive: false });
      mockPrisma.subscription.findUnique.mockResolvedValue(existing);
      mockPlansService.findById.mockResolvedValue(inactivePlan);

      const dto: UpdateSubscriptionDto = { planId: 'plan-uuid-2' };

      await expect(service.update(SUBSCRIPTION_ID, dto)).rejects.toMatchObject({
        errorCode: 'PLAN_NOT_ACTIVE',
      });
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // changePlan
  // -----------------------------------------------------------------------
  describe('changePlan', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';
    const NEW_PLAN_ID = 'plan-uuid-2';

    it('changes plan successfully', async () => {
      const newPlan = buildPlan({ id: NEW_PLAN_ID, maxLocations: 10 });
      const subscription = buildSubscription({ locations: [buildLocation()] });
      const updated = buildSubscription({ planId: NEW_PLAN_ID, plan: newPlan });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPlansService.findById.mockResolvedValue(newPlan);
      mockPrisma.subscription.update.mockResolvedValue(updated);

      const result = await service.changePlan(SUBSCRIPTION_ID, NEW_PLAN_ID);

      expect(mockPlansService.findById).toHaveBeenCalledWith(NEW_PLAN_ID);
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUBSCRIPTION_ID },
        data: { planId: NEW_PLAN_ID },
        include: { plan: true },
      });
      expect(result).toEqual(updated);
    });

    it('throws PLAN_NOT_ACTIVE when new plan is inactive', async () => {
      const inactivePlan = buildPlan({ id: NEW_PLAN_ID, isActive: false });
      const subscription = buildSubscription();
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPlansService.findById.mockResolvedValue(inactivePlan);

      await expect(
        service.changePlan(SUBSCRIPTION_ID, NEW_PLAN_ID),
      ).rejects.toMatchObject({
        errorCode: 'PLAN_NOT_ACTIVE',
      });
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('logs warning when location count exceeds new plan limit', async () => {
      const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();
      const oldPlan = buildPlan({ maxLocations: 10 });
      const newPlan = buildPlan({ id: NEW_PLAN_ID, maxLocations: 2 });
      const subscription = buildSubscription({
        plan: oldPlan,
        locations: [
          buildLocation({ id: 'loc-1' }),
          buildLocation({ id: 'loc-2' }),
          buildLocation({ id: 'loc-3' }),
        ],
      });
      const updated = buildSubscription({
        planId: NEW_PLAN_ID,
        plan: newPlan,
        locations: subscription.locations,
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPlansService.findById.mockResolvedValue(newPlan);
      mockPrisma.subscription.update.mockResolvedValue(updated);

      await service.changePlan(SUBSCRIPTION_ID, NEW_PLAN_ID);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('3 active locations exceed new limit of 2'),
      );
      expect(mockPrisma.subscription.update).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });

  // -----------------------------------------------------------------------
  // suspend
  // -----------------------------------------------------------------------
  describe('suspend', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';

    it('suspends subscription', async () => {
      const subscription = buildSubscription({ status: 'ACTIVE' });
      const suspended = buildSubscription({ status: 'SUSPENDED' });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPrisma.subscription.update.mockResolvedValue(suspended);

      const result = await service.suspend(SUBSCRIPTION_ID);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUBSCRIPTION_ID },
        data: { status: 'SUSPENDED' },
        include: { plan: true },
      });
      expect(result.status).toBe('SUSPENDED');
    });
  });

  // -----------------------------------------------------------------------
  // cancel
  // -----------------------------------------------------------------------
  describe('cancel', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';

    it('cancels with cancelAtPeriodEnd=true by default', async () => {
      const subscription = buildSubscription({ status: 'ACTIVE' });
      const cancelled = buildSubscription({
        status: 'ACTIVE',
        cancelAtPeriodEnd: true,
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPrisma.subscription.update.mockResolvedValue(cancelled);

      const result = await service.cancel(SUBSCRIPTION_ID);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUBSCRIPTION_ID },
        data: { cancelAtPeriodEnd: true },
        include: { plan: true },
      });
      // Status unchanged, cancelAtPeriodEnd set to true
      expect(result.cancelAtPeriodEnd).toBe(true);
    });

    it('cancels immediately with cancelAtPeriodEnd=false', async () => {
      const subscription = buildSubscription({ status: 'ACTIVE' });
      const cancelled = buildSubscription({
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelAtPeriodEnd: false,
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPrisma.subscription.update.mockResolvedValue(cancelled);

      const result = await service.cancel(SUBSCRIPTION_ID, false);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUBSCRIPTION_ID },
        data: {
          cancelAtPeriodEnd: false,
          status: 'CANCELLED',
          cancelledAt: expect.any(Date),
        },
        include: { plan: true },
      });
      expect(result.status).toBe('CANCELLED');
    });

    it('throws SUBSCRIPTION_ALREADY_TERMINATED when already cancelled', async () => {
      const cancelledSub = buildSubscription({ status: 'CANCELLED' });
      mockPrisma.subscription.findUnique.mockResolvedValue(cancelledSub);

      await expect(service.cancel(SUBSCRIPTION_ID)).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_ALREADY_TERMINATED',
      });
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('throws SUBSCRIPTION_ALREADY_TERMINATED when already expired', async () => {
      const expiredSub = buildSubscription({ status: 'EXPIRED' });
      mockPrisma.subscription.findUnique.mockResolvedValue(expiredSub);

      await expect(
        service.cancel(SUBSCRIPTION_ID, true),
      ).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_ALREADY_TERMINATED',
      });
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // reactivate
  // -----------------------------------------------------------------------
  describe('reactivate', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';

    it('reactivates from SUSPENDED status', async () => {
      const suspendedSub = buildSubscription({ status: 'SUSPENDED' });
      const activeSub = buildSubscription({
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(suspendedSub);
      mockPrisma.subscription.update.mockResolvedValue(activeSub);

      const result = await service.reactivate(SUBSCRIPTION_ID);

      expect(mockPrisma.subscription.update).toHaveBeenCalledWith({
        where: { id: SUBSCRIPTION_ID },
        data: { status: 'ACTIVE', cancelAtPeriodEnd: false },
        include: { plan: true },
      });
      expect(result.status).toBe('ACTIVE');
    });

    it('reactivates from PAST_DUE status', async () => {
      const pastDueSub = buildSubscription({ status: 'PAST_DUE' });
      const activeSub = buildSubscription({
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(pastDueSub);
      mockPrisma.subscription.update.mockResolvedValue(activeSub);

      const result = await service.reactivate(SUBSCRIPTION_ID);

      expect(result.status).toBe('ACTIVE');
    });

    it('throws SUBSCRIPTION_CANNOT_REACTIVATE for ACTIVE status', async () => {
      const activeSub = buildSubscription({ status: 'ACTIVE' });
      mockPrisma.subscription.findUnique.mockResolvedValue(activeSub);

      await expect(service.reactivate(SUBSCRIPTION_ID)).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_CANNOT_REACTIVATE',
      });
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('throws SUBSCRIPTION_CANNOT_REACTIVATE for CANCELLED status', async () => {
      const cancelledSub = buildSubscription({ status: 'CANCELLED' });
      mockPrisma.subscription.findUnique.mockResolvedValue(cancelledSub);

      await expect(service.reactivate(SUBSCRIPTION_ID)).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_CANNOT_REACTIVATE',
      });
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });

    it('throws SUBSCRIPTION_CANNOT_REACTIVATE for EXPIRED status', async () => {
      const expiredSub = buildSubscription({ status: 'EXPIRED' });
      mockPrisma.subscription.findUnique.mockResolvedValue(expiredSub);

      await expect(service.reactivate(SUBSCRIPTION_ID)).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_CANNOT_REACTIVATE',
      });
      expect(mockPrisma.subscription.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // recordPayment
  // -----------------------------------------------------------------------
  describe('recordPayment', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';

    it('records payment, creates payment history entry, and extends period', async () => {
      const subscription = buildSubscription({
        status: 'PAST_DUE',
        currentPeriodEnd: new Date('2026-07-01'),
        plan: buildPlan(),
      });
      const updatedSub = buildSubscription({
        status: 'ACTIVE',
        lastPaymentAt: new Date(),
        paymentReference: 'REF-001',
        currentPeriodEnd: expect.any(Date) as unknown as Date,
        nextPaymentDueAt: expect.any(Date) as unknown as Date,
        cancelAtPeriodEnd: false,
      });
      const paymentRecord = buildPaymentHistory();
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPrisma.subscriptionPaymentHistory.create.mockResolvedValue(paymentRecord);
      mockPrisma.subscription.update.mockResolvedValue(updatedSub);

      const dto: RecordPaymentDto = {
        amountCents: 50000,
        currency: 'COP',
        paymentMethod: 'Bank transfer',
        paymentReference: 'REF-001',
        notes: 'Payment received',
        recordedById: 'admin-uuid-1',
      };
      const result = await service.recordPayment(SUBSCRIPTION_ID, dto);

      expect(mockPrisma.subscriptionPaymentHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: SUBSCRIPTION_ID,
            amountCents: 50000,
            currency: 'COP',
            paymentReference: 'REF-001',
            recordedById: 'admin-uuid-1',
          }),
        }),
      );
      expect(mockPrisma.subscription.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SUBSCRIPTION_ID },
          data: expect.objectContaining({
            status: 'ACTIVE',
            paymentReference: 'REF-001',
            cancelAtPeriodEnd: false,
          }),
        }),
      );
      expect(result.status).toBe('ACTIVE');
    });

    it('uses default currency COP when not provided', async () => {
      const subscription = buildSubscription({
        currentPeriodEnd: new Date('2026-07-01'),
        plan: buildPlan(),
      });
      const updatedSub = buildSubscription({ status: 'ACTIVE' });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPrisma.subscriptionPaymentHistory.create.mockResolvedValue(
        buildPaymentHistory(),
      );
      mockPrisma.subscription.update.mockResolvedValue(updatedSub);

      const dto: RecordPaymentDto = { amountCents: 25000 };
      await service.recordPayment(SUBSCRIPTION_ID, dto);

      expect(mockPrisma.subscriptionPaymentHistory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ currency: 'COP' }),
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // findByHardwareFingerprint
  // -----------------------------------------------------------------------
  describe('findByHardwareFingerprint', () => {
    const FINGERPRINT = 'fp-unique-abc123';

    it('finds activation by hardware fingerprint with includes', async () => {
      const activation = buildWorkstationActivation({
        hardwareFingerprint: FINGERPRINT,
      });
      mockPrisma.workstationActivation.findFirst.mockResolvedValue(activation);

      const result = await service.findByHardwareFingerprint(FINGERPRINT);

      expect(mockPrisma.workstationActivation.findFirst).toHaveBeenCalledWith({
        where: { hardwareFingerprint: FINGERPRINT, isActive: true },
        include: {
          subscription: { include: { plan: true } },
          location: true,
        },
      });
      expect(result).toEqual(activation);
    });

    it('returns null when no activation matches', async () => {
      mockPrisma.workstationActivation.findFirst.mockResolvedValue(null);

      const result = await service.findByHardwareFingerprint('unknown-fp');

      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // evaluateStatusTransitions (cron job)
  // -----------------------------------------------------------------------
  describe('evaluateStatusTransitions', () => {
    it('marks expired subscriptions, past-due, grace-expired, and trial-expired', async () => {
      mockPrisma.subscription.updateMany
        // First call: expired subs (TRIAL/ACTIVE past period end)
        .mockResolvedValueOnce({ count: 2 })
        // Second call: past-due subs (ACTIVE past period end)
        .mockResolvedValueOnce({ count: 1 })
        // Third call: trial-expired
        .mockResolvedValueOnce({ count: 1 });
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([
        { id: 'sub-grace-1' },
      ]);

      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

      await service.evaluateStatusTransitions();

      // First updateMany: expired from TRIAL/ACTIVE
      expect(mockPrisma.subscription.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          currentPeriodEnd: { lt: expect.any(Date) },
          status: { in: ['TRIAL', 'ACTIVE'] },
        },
        data: { status: 'EXPIRED' },
      });

      // Second updateMany: past-due from ACTIVE
      expect(mockPrisma.subscription.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          currentPeriodEnd: { lt: expect.any(Date) },
          status: 'ACTIVE',
        },
        data: { status: 'PAST_DUE' },
      });

      // $queryRaw was called for grace-expired
      expect(mockPrisma.$queryRaw).toHaveBeenCalled();

      // Third updateMany: trial expired
      expect(mockPrisma.subscription.updateMany).toHaveBeenNthCalledWith(3, {
        where: {
          status: 'TRIAL',
          trialEndsAt: { lt: expect.any(Date) },
        },
        data: { status: 'EXPIRED' },
      });

      // 1 start + 4 transition logs + 1 end = 6 total
      expect(logSpy).toHaveBeenCalledTimes(6);
      logSpy.mockRestore();
    });

    it('logs start and end when no transitions occur', async () => {
      mockPrisma.subscription.updateMany
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 })
        .mockResolvedValueOnce({ count: 0 });
      (mockPrisma.$queryRaw as jest.Mock).mockResolvedValue([]);

      const logSpy = jest.spyOn(service['logger'], 'log').mockImplementation();

      await service.evaluateStatusTransitions();

      // Only the start and end log messages
      expect(logSpy).toHaveBeenCalledWith(
        'Evaluating subscription status transitions...',
      );
      expect(logSpy).toHaveBeenCalledWith(
        'Subscription status evaluation complete.',
      );
      // No transition-specific logs since counts are 0
      expect(logSpy).toHaveBeenCalledTimes(2);
      logSpy.mockRestore();
    });
  });
});
