// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { LocationsService } from './locations.service';
import { DomainException } from '@/common/exceptions/domain.exception';
import type { CreateLocationDto, UpdateLocationDto } from './dto/location.dto';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildPlan(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'plan-uuid-1',
    code: 'PLAN_BASIC',
    name: 'Plan Basic',
    description: 'Basic plan',
    pricingModel: 'FLAT' as const,
    basePriceCents: 20000,
    currency: 'COP',
    billingPeriod: 'MONTHLY' as const,
    maxLocations: 3,
    maxWorkstationsPerLocation: 1,
    includedWorkstations: 1,
    extraWorkstationPriceCents: 5000,
    features: ['feature-a'],
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
    customerPhone: null,
    customerAddress: null,
    status: 'ACTIVE' as const,
    currentPeriodStart: new Date('2026-06-01'),
    currentPeriodEnd: new Date('2026-07-01'),
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
    cancelledAt: null,
    paymentMethod: null,
    paymentReference: null,
    lastPaymentAt: null,
    nextPaymentDueAt: null,
    gracePeriodDays: 7,
    locations: [],
    activationCodes: [],
    workstationActivations: [],
    licenseCheckIns: [],
    fraudAlerts: [],
    paymentHistory: [],
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
    phone: '+571234567890',
    email: 'store@example.com',
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

function buildActivationCode(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'code-uuid-1',
    subscriptionId: 'sub-uuid-1',
    locationId: 'loc-uuid-1',
    code: 'ABCD-EFGH-IJKL-MNOP5',
    type: 'WORKSTATION' as const,
    status: 'UNUSED' as const,
    usedAt: null,
    usedByActivationId: null,
    usedByActivation: null,
    expiresAt: new Date('2027-06-01'),
    createdAt: new Date('2026-06-01'),
    ...overrides,
  };
}

function buildWorkstationActivation(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: 'activation-uuid-1',
    subscriptionId: 'sub-uuid-1',
    locationId: 'loc-uuid-1',
    hardwareFingerprint: 'fp-unique-abc123',
    workstationName: 'WS-001',
    activationCodeId: null,
    activationCode: null,
    isActive: true,
    activatedAt: new Date('2026-06-01'),
    revokedAt: null,
    revokedReason: null,
    lastCheckInAt: null,
    lastCheckInIp: null,
    initialActivationIp: null,
    checkInCount: 0,
    licenseCheckIns: [],
    fraudAlerts: [],
    createdAt: new Date('2026-06-01'),
    updatedAt: new Date('2026-06-01'),
    subscription: { status: 'ACTIVE' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LocationsService', () => {
  let service: LocationsService;
  let mockPrisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    mockPrisma = mockDeep<PrismaClient>();
    service = new LocationsService(mockPrisma as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';
    const createDto: CreateLocationDto = {
      name: 'New Store',
      address: 'Carrera 15 #10-20',
      city: 'Medellín',
      region: 'Antioquia',
      country: 'CO',
      taxId: '900987654',
      phone: '+574000000000',
      email: 'newstore@example.com',
      latitude: 6.2476,
      longitude: -75.5658,
      notes: 'Second location',
    };

    it('creates location successfully within plan limits', async () => {
      const plan = buildPlan({ maxLocations: 3 });
      const subscription = buildSubscription({
        plan,
        locations: [buildLocation({ id: 'loc-1' }), buildLocation({ id: 'loc-2' })],
      });
      const newLocation = buildLocation({
        id: 'loc-new',
        name: 'New Store',
        address: 'Carrera 15 #10-20',
        city: 'Medellín',
        region: 'Antioquia',
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPrisma.location.create.mockResolvedValue(newLocation);

      const result = await service.create(SUBSCRIPTION_ID, createDto);

      expect(mockPrisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { id: SUBSCRIPTION_ID },
        include: { plan: true, locations: { where: { isActive: true } } },
      });
      expect(mockPrisma.location.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: SUBSCRIPTION_ID,
            name: 'New Store',
            address: 'Carrera 15 #10-20',
            city: 'Medellín',
            region: 'Antioquia',
            country: 'CO',
            taxId: '900987654',
            phone: '+574000000000',
            email: 'newstore@example.com',
          }),
        }),
      );
      expect(result).toEqual(newLocation);
    });

    it('creates location without optional fields', async () => {
      const plan = buildPlan({ maxLocations: 3 });
      const subscription = buildSubscription({ plan, locations: [] });
      const minimalDto: CreateLocationDto = { name: 'Minimal Store' };
      const newLocation = buildLocation({ name: 'Minimal Store' });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);
      mockPrisma.location.create.mockResolvedValue(newLocation);

      const result = await service.create(SUBSCRIPTION_ID, minimalDto);

      expect(mockPrisma.location.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: 'Minimal Store',
            address: null,
            city: null,
            region: null,
            country: 'CO',
            taxId: null,
            phone: null,
            email: null,
            notes: null,
          }),
        }),
      );
      expect(result).toEqual(newLocation);
    });

    it('throws SUBSCRIPTION_NOT_FOUND for invalid subscriptionId', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.create('nonexistent-id', createDto),
      ).rejects.toThrow(DomainException);
      await expect(
        service.create('nonexistent-id', createDto),
      ).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_NOT_FOUND',
      });
      expect(mockPrisma.location.create).not.toHaveBeenCalled();
    });

    it('throws PLAN_LIMIT_EXCEEDED when max locations already reached', async () => {
      const plan = buildPlan({ maxLocations: 2 });
      const subscription = buildSubscription({
        plan,
        locations: [buildLocation({ id: 'loc-1' }), buildLocation({ id: 'loc-2' })],
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      await expect(service.create(SUBSCRIPTION_ID, createDto)).rejects.toThrow(
        DomainException,
      );
      await expect(service.create(SUBSCRIPTION_ID, createDto)).rejects.toMatchObject(
        {
          errorCode: 'PLAN_LIMIT_EXCEEDED',
        },
      );
      expect(mockPrisma.location.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // findById
  // -----------------------------------------------------------------------
  describe('findById', () => {
    const LOCATION_ID = 'loc-uuid-1';

    it('returns location with all includes', async () => {
      const activation = buildWorkstationActivation();
      const code = buildActivationCode();
      const location = buildLocation({
        workstationActivations: [activation],
        activationCodes: [code],
      });
      mockPrisma.location.findUnique.mockResolvedValue(location);

      const result = await service.findById(LOCATION_ID);

      expect(mockPrisma.location.findUnique).toHaveBeenCalledWith({
        where: { id: LOCATION_ID },
        include: {
          workstationActivations: {
            include: { subscription: { select: { status: true } } },
            orderBy: { activatedAt: 'desc' },
          },
          activationCodes: { where: { status: 'UNUSED' } },
        },
      });
      expect(result).toEqual(location);
    });

    it('throws LOCATION_NOT_FOUND when location does not exist', async () => {
      mockPrisma.location.findUnique.mockResolvedValue(null);

      await expect(service.findById(LOCATION_ID)).rejects.toThrow(DomainException);
      await expect(service.findById(LOCATION_ID)).rejects.toMatchObject({
        errorCode: 'LOCATION_NOT_FOUND',
      });
    });
  });

  // -----------------------------------------------------------------------
  // findBySubscription
  // -----------------------------------------------------------------------
  describe('findBySubscription', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';

    it('returns locations for subscription ordered by name', async () => {
      const locations = [
        buildLocation({ id: 'loc-1', name: 'Alpha Store' }),
        buildLocation({ id: 'loc-2', name: 'Beta Store' }),
      ];
      mockPrisma.location.findMany.mockResolvedValue(locations);

      const result = await service.findBySubscription(SUBSCRIPTION_ID);

      expect(mockPrisma.location.findMany).toHaveBeenCalledWith({
        where: { subscriptionId: SUBSCRIPTION_ID },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual(locations);
    });

    it('returns empty array when no locations exist', async () => {
      mockPrisma.location.findMany.mockResolvedValue([]);

      const result = await service.findBySubscription(SUBSCRIPTION_ID);

      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update', () => {
    const LOCATION_ID = 'loc-uuid-1';

    it('updates location fields when valid DTO is provided', async () => {
      const existing = buildLocation();
      const updated = buildLocation({
        name: 'Renamed Store',
        phone: '+570000000000',
      });
      mockPrisma.location.findUnique.mockResolvedValue(existing);
      mockPrisma.location.update.mockResolvedValue(updated);

      const dto: UpdateLocationDto = {
        name: 'Renamed Store',
        phone: '+570000000000',
      };
      const result = await service.update(LOCATION_ID, dto);

      expect(mockPrisma.location.update).toHaveBeenCalledWith({
        where: { id: LOCATION_ID },
        data: {
          name: 'Renamed Store',
          phone: '+570000000000',
        },
      });
      expect(result).toEqual(updated);
    });

    it('only updates provided fields', async () => {
      const existing = buildLocation();
      mockPrisma.location.findUnique.mockResolvedValue(existing);
      mockPrisma.location.update.mockResolvedValue(existing);

      const dto: UpdateLocationDto = { city: 'Cali' };
      await service.update(LOCATION_ID, dto);

      expect(mockPrisma.location.update).toHaveBeenCalledWith({
        where: { id: LOCATION_ID },
        data: { city: 'Cali' },
      });
    });

    it('throws LOCATION_NOT_FOUND when location is missing', async () => {
      mockPrisma.location.findUnique.mockResolvedValue(null);

      const dto: UpdateLocationDto = { name: 'Ghost Store' };

      await expect(service.update(LOCATION_ID, dto)).rejects.toMatchObject({
        errorCode: 'LOCATION_NOT_FOUND',
      });
      expect(mockPrisma.location.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // deactivate
  // -----------------------------------------------------------------------
  describe('deactivate', () => {
    const LOCATION_ID = 'loc-uuid-1';

    it('soft-deletes the location by setting isActive to false', async () => {
      const existing = buildLocation({ isActive: true });
      const deactivated = buildLocation({
        isActive: false,
        workstationActivations: [],
      });
      mockPrisma.location.findUnique.mockResolvedValue(existing);
      mockPrisma.location.update.mockResolvedValue(deactivated);

      const result = await service.deactivate(LOCATION_ID);

      expect(mockPrisma.location.update).toHaveBeenCalledWith({
        where: { id: LOCATION_ID },
        data: { isActive: false },
        include: { workstationActivations: true },
      });
      expect(result.isActive).toBe(false);
    });

    it('throws LOCATION_NOT_FOUND when location does not exist', async () => {
      mockPrisma.location.findUnique.mockResolvedValue(null);

      await expect(service.deactivate(LOCATION_ID)).rejects.toMatchObject({
        errorCode: 'LOCATION_NOT_FOUND',
      });
      expect(mockPrisma.location.update).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // getLocationLimitStatus
  // -----------------------------------------------------------------------
  describe('getLocationLimitStatus', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';

    it('returns correct limit info when below max', async () => {
      const plan = buildPlan({ maxLocations: 5 });
      const subscription = buildSubscription({
        plan,
        locations: [
          buildLocation({ id: 'loc-1' }),
          buildLocation({ id: 'loc-2' }),
        ],
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.getLocationLimitStatus(SUBSCRIPTION_ID);

      expect(result).toEqual({
        maxLocations: 5,
        activeLocations: 2,
        canAddLocation: true,
      });
    });

    it('returns correct limit info when at max', async () => {
      const plan = buildPlan({ maxLocations: 3 });
      const subscription = buildSubscription({
        plan,
        locations: [
          buildLocation({ id: 'loc-1' }),
          buildLocation({ id: 'loc-2' }),
          buildLocation({ id: 'loc-3' }),
        ],
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.getLocationLimitStatus(SUBSCRIPTION_ID);

      expect(result).toEqual({
        maxLocations: 3,
        activeLocations: 3,
        canAddLocation: false,
      });
    });

    it('returns zero active for empty locations', async () => {
      const plan = buildPlan({ maxLocations: 5 });
      const subscription = buildSubscription({ plan, locations: [] });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription);

      const result = await service.getLocationLimitStatus(SUBSCRIPTION_ID);

      expect(result).toEqual({
        maxLocations: 5,
        activeLocations: 0,
        canAddLocation: true,
      });
    });

    it('throws SUBSCRIPTION_NOT_FOUND when subscription does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      await expect(
        service.getLocationLimitStatus('bad-id'),
      ).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_NOT_FOUND',
      });
    });
  });
});
