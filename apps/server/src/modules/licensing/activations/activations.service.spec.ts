import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());


import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { HttpStatus } from '@nestjs/common';
import { ActivationsService } from './activations.service';
import { LicenseTokenService } from '../tokens/license-token.service';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { DomainException } from '@/common/exceptions/domain.exception';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildSubscription(overrides: Record<string, unknown> = {}) {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: 'sub-uuid-1',
    status: 'ACTIVE',
    customerName: 'Test Pharmacy',
    currentPeriodEnd: future,
    gracePeriodDays: 7,
    plan: {
      id: 'plan-uuid-1',
      code: 'PHARMACY_PRO',
      name: 'Pharmacy Pro',
      billingMethod: 'PROVIDER',
      features: ['unlimited_sales', 'inventory_management'],
      maxLocations: 3,
      maxWorkstationsPerLocation: 5,
    },
    ...overrides,
  };
}

function buildLocation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'loc-uuid-1',
    subscriptionId: 'sub-uuid-1',
    name: 'Main Store',
    address: 'Calle 123',
    city: 'Bogotá',
    region: 'Cundinamarca',
    isActive: true,
    workstationActivations: [],
    ...overrides,
  };
}

function buildActivationCode(overrides: Record<string, unknown> = {}) {
  const future = new Date();
  future.setFullYear(future.getFullYear() + 1);
  return {
    id: 'code-uuid-1',
    subscriptionId: 'sub-uuid-1',
    locationId: null,
    code: 'ABCD-EFGH-IJKL-MNOP5',
    type: 'WORKSTATION',
    status: 'UNUSED',
    expiresAt: future,
    usedAt: null,
    usedByActivationId: null,
    ...overrides,
  };
}

function buildWorkstationActivation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'activation-uuid-1',
    subscriptionId: 'sub-uuid-1',
    locationId: 'loc-uuid-1',
    hardwareFingerprint: 'fp-abc123def456',
    workstationName: 'POS-1',
    activationCodeId: 'code-uuid-1',
    isActive: true,
    activatedAt: new Date(),
    initialActivationIp: '192.168.1.100',
    lastCheckInAt: null,
    lastCheckInIp: null,
    checkInCount: 0,
    ...overrides,
  };
}

function buildGenerateActivationCodeDto(overrides: Record<string, unknown> = {}) {
  return {
    type: 'WORKSTATION',
    locationId: 'loc-uuid-1',
    ...overrides,
  };
}

function buildActivateDto(overrides: Record<string, unknown> = {}) {
  return {
    code: 'ABCD-EFGH-IJKL-MNOP5',
    hardwareFingerprint: 'fp-abc123def456',
    workstationName: 'POS-1',
    locationName: 'Main Store',
    ...overrides,
  };
}

function buildTokenResult(tokenOverrides: Record<string, unknown> = {}) {
  return {
    token: 'signed-jwt-token-string',
    expiresAt: new Date(Date.now() + 604800000).toISOString(),
    ...tokenOverrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = mockDeep<PrismaClient>();

// Separate deep mock for the interactive-transaction client: unlike specs
// that replay the callback with mockPrisma itself, these flows are required
// to prove writes go THROUGH the tx (never this.prisma.*) and share ONE tx
// client, so the callback receives a distinct mock whose delegates are
// asserted directly.
let mockTx: DeepMockProxy<PrismaClient>;

const mockLicenseTokenService = {
  generateToken: jest.fn(),
} as unknown as jest.Mocked<LicenseTokenService>;

const mockFraudDetectionService = {
  runActivationChecks: jest.fn(),
} as unknown as jest.Mocked<FraudDetectionService>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ActivationsService', () => {
  let service: ActivationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    // $transaction(interactive) must invoke its callback with the tx client -
    // never assume a transaction callback runs without wiring this explicitly.
    mockTx = mockDeep<PrismaClient>();
    mockPrisma.$transaction.mockImplementation(async (cb: any) => cb(mockTx));
    service = new ActivationsService(
      mockPrisma as any,
      mockLicenseTokenService,
      mockFraudDetectionService,
    );
  });

  // -----------------------------------------------------------------------
  // generateActivationCode
  // -----------------------------------------------------------------------
  describe('generateActivationCode', () => {
    const SUBSCRIPTION_ID = 'sub-uuid-1';

    it('generates a WORKSTATION code with location', async () => {
      const subscription = buildSubscription();
      const location = buildLocation();
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription as any);
      mockTx.location.findUnique.mockResolvedValue(location as any);
      mockTx.workstationActivation.count.mockResolvedValue(0);
      mockTx.activationCode.create.mockResolvedValue({ id: 'new-code-uuid' } as any);

      const dto = buildGenerateActivationCodeDto();
      const result = await service.generateActivationCode(SUBSCRIPTION_ID, dto);

      expect(result).toEqual({ id: 'new-code-uuid' });
      expect(mockTx.workstationActivation.count).toHaveBeenCalledWith({
        where: { locationId: 'loc-uuid-1', isActive: true },
      });
      expect(mockTx.activationCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: SUBSCRIPTION_ID,
            locationId: 'loc-uuid-1',
            type: 'WORKSTATION',
            status: 'UNUSED',
          }),
        }),
      );
      expect(mockPrisma.activationCode.create).not.toHaveBeenCalled();
    });

    it('throws SUBSCRIPTION_NOT_FOUND when subscription does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      const dto = buildGenerateActivationCodeDto();

      await expect(
        service.generateActivationCode('nonexistent-id', dto),
      ).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('throws SUBSCRIPTION_NOT_ACTIVE when subscription is not ACTIVE or TRIAL', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscription({ status: 'EXPIRED' }) as any,
      );

      const dto = buildGenerateActivationCodeDto();

      await expect(
        service.generateActivationCode(SUBSCRIPTION_ID, dto),
      ).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_NOT_ACTIVE',
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('throws WORKSTATION_LIMIT_EXCEEDED when the target location is at its plan limit', async () => {
      const subscription = buildSubscription({
        plan: { ...buildSubscription().plan, maxWorkstationsPerLocation: 2 },
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription as any);
      mockTx.location.findUnique.mockResolvedValue(buildLocation() as any);
      mockTx.workstationActivation.count.mockResolvedValue(2);

      const dto = buildGenerateActivationCodeDto();

      await expect(
        service.generateActivationCode(SUBSCRIPTION_ID, dto),
      ).rejects.toMatchObject({
        errorCode: 'WORKSTATION_LIMIT_EXCEEDED',
        status: HttpStatus.FORBIDDEN,
      });
      expect(mockTx.activationCode.create).not.toHaveBeenCalled();
      expect(mockPrisma.activationCode.create).not.toHaveBeenCalled();
    });

    it('throws LOCATION_NOT_FOUND when locationId does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(buildSubscription() as any);
      mockTx.location.findUnique.mockResolvedValue(null);

      const dto = buildGenerateActivationCodeDto();

      await expect(
        service.generateActivationCode(SUBSCRIPTION_ID, dto),
      ).rejects.toMatchObject({
        errorCode: 'LOCATION_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('throws LOCATION_MISMATCH when location belongs to a different subscription', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(buildSubscription() as any);
      mockTx.location.findUnique.mockResolvedValue(
        buildLocation({ subscriptionId: 'other-sub-uuid' }) as any,
      );

      const dto = buildGenerateActivationCodeDto();

      await expect(
        service.generateActivationCode(SUBSCRIPTION_ID, dto),
      ).rejects.toMatchObject({
        errorCode: 'LOCATION_MISMATCH',
        status: HttpStatus.FORBIDDEN,
      });
      expect(mockTx.activationCode.create).not.toHaveBeenCalled();
    });

    it('throws INVALID_CODE_TYPE_FOR_ENDPOINT for a SUBSCRIPTION-type code', async () => {
      // SUBSCRIPTION codes are minted only by SubscriptionsService at
      // checkout; the endpoint must never issue one (unlimited-location bypass).
      mockPrisma.subscription.findUnique.mockResolvedValue(buildSubscription() as any);

      const dto = buildGenerateActivationCodeDto({
        type: 'SUBSCRIPTION',
        locationId: null,
      });

      await expect(
        service.generateActivationCode(SUBSCRIPTION_ID, dto),
      ).rejects.toMatchObject({
        errorCode: 'INVALID_CODE_TYPE_FOR_ENDPOINT',
        status: HttpStatus.BAD_REQUEST,
      });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(mockTx.activationCode.create).not.toHaveBeenCalled();
      expect(mockPrisma.activationCode.create).not.toHaveBeenCalled();
    });

    it('throws LOCATION_ID_REQUIRED for a WORKSTATION code without a locationId', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(buildSubscription() as any);

      const dto = buildGenerateActivationCodeDto({ locationId: null });

      await expect(
        service.generateActivationCode(SUBSCRIPTION_ID, dto),
      ).rejects.toMatchObject({
        errorCode: 'LOCATION_ID_REQUIRED',
        status: HttpStatus.BAD_REQUEST,
      });
      expect(mockTx.$executeRaw).not.toHaveBeenCalled();
      expect(mockTx.activationCode.create).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // activate
  // -----------------------------------------------------------------------
  describe('activate', () => {
    const REQUEST_IP = '192.168.1.100';

    beforeEach(() => {
      // Default fraud check passes
      mockFraudDetectionService.runActivationChecks.mockResolvedValue({
        shouldReject: false,
        reason: null,
        signals: [],
      });
      // Default token
      mockLicenseTokenService.generateToken.mockReturnValue(buildTokenResult());
      // Defaults for the interactive-transaction body (WORKSTATION flow)
      mockTx.location.findUnique.mockResolvedValue(buildLocation() as any);
      mockTx.location.count.mockResolvedValue(0);
      mockTx.workstationActivation.count.mockResolvedValue(0);
      mockTx.workstationActivation.create.mockResolvedValue(
        buildWorkstationActivation() as any,
      );
      mockTx.activationCode.update.mockResolvedValue({} as any);
    });

    it('fully activates a SUBSCRIPTION type (creates location + activation)', async () => {
      const subscription = buildSubscription();
      const activationCode = buildActivationCode({
        type: 'SUBSCRIPTION',
        subscription,
        locationId: null,
      });
      const newLocation = buildLocation({ id: 'new-loc-uuid' });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);
      mockTx.location.create.mockResolvedValue(newLocation as any);
      mockTx.location.findUnique.mockResolvedValue(newLocation as any);

      const dto = buildActivateDto({ locationName: 'New Store' });
      const result = await service.activate(dto, REQUEST_IP);

      // Location was created from dto.locationName (optional fields default to null)
      expect(mockTx.location.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-uuid-1',
            name: 'New Store',
            address: null,
            city: null,
            region: null,
            country: 'CO',
            isActive: true,
          }),
        }),
      );

      // Activation was created and bound to the newly created location
      expect(mockTx.workstationActivation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: 'sub-uuid-1',
            locationId: 'new-loc-uuid',
          }),
        }),
      );

      // Code was marked as used
      expect(mockTx.activationCode.update).toHaveBeenCalled();

      // Token was generated
      expect(mockLicenseTokenService.generateToken).toHaveBeenCalled();

      // Writes went through the transaction client, never through this.prisma.*
      expect(mockPrisma.location.create).not.toHaveBeenCalled();
      expect(mockPrisma.workstationActivation.create).not.toHaveBeenCalled();
      expect(mockPrisma.activationCode.update).not.toHaveBeenCalled();

      // Response shape
      expect(result.activationToken).toBe('signed-jwt-token-string');
      expect(result.subscription.id).toBe('sub-uuid-1');
      expect(result.location).not.toBeNull();
      expect(result.location?.id).toBe('new-loc-uuid');
      expect(result.plan.code).toBe('PHARMACY_PRO');
    });

    it('throws PLAN_LIMIT_EXCEEDED for a SUBSCRIPTION code when active locations equal maxLocations and creates nothing', async () => {
      const subscription = buildSubscription({
        plan: { ...buildSubscription().plan, maxLocations: 2 },
      });
      const activationCode = buildActivationCode({
        type: 'SUBSCRIPTION',
        subscription,
        locationId: null,
      });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);
      mockTx.location.count.mockResolvedValue(2);

      const dto = buildActivateDto({ locationName: 'Overflow Store' });

      await expect(service.activate(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'PLAN_LIMIT_EXCEEDED',
        status: HttpStatus.FORBIDDEN,
      });
      // Rejection happens before any write in the transaction body
      expect(mockTx.location.create).not.toHaveBeenCalled();
      expect(mockTx.workstationActivation.create).not.toHaveBeenCalled();
      expect(mockTx.activationCode.update).not.toHaveBeenCalled();
    });

    it('acquires the location advisory lock before counting and creating on the SUBSCRIPTION path', async () => {
      const subscription = buildSubscription();
      const activationCode = buildActivationCode({
        type: 'SUBSCRIPTION',
        subscription,
        locationId: null,
      });
      const newLocation = buildLocation({ id: 'new-loc-uuid' });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);
      mockTx.location.count.mockResolvedValue(0);
      mockTx.location.create.mockResolvedValue(newLocation as any);
      mockTx.location.findUnique.mockResolvedValue(newLocation as any);

      const dto = buildActivateDto({ locationName: 'New Store' });
      await service.activate(dto, REQUEST_IP);

      // First lock (scope `${subscriptionId}:LOCATION`) runs before the
      // location count-then-create section
      expect(mockTx.$executeRaw).toHaveBeenCalled();
      const firstLockOrder = mockTx.$executeRaw.mock.invocationCallOrder[0];
      expect(firstLockOrder).toBeLessThan(
        mockTx.location.count.mock.invocationCallOrder[0],
      );
      expect(firstLockOrder).toBeLessThan(
        mockTx.location.create.mock.invocationCallOrder[0],
      );
    });

    it('fully activates a WORKSTATION type (uses existing location)', async () => {
      const subscription = buildSubscription();
      const activationCode = buildActivationCode({
        type: 'WORKSTATION',
        subscription,
        locationId: 'loc-uuid-1',
      });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);

      const dto = buildActivateDto({ locationName: undefined });
      const result = await service.activate(dto, REQUEST_IP);

      // No location was created
      expect(mockTx.location.create).not.toHaveBeenCalled();

      // Activation was created
      expect(mockTx.workstationActivation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            locationId: 'loc-uuid-1',
            subscriptionId: 'sub-uuid-1',
            hardwareFingerprint: 'fp-abc123def456',
          }),
        }),
      );

      expect(result.subscription.id).toBe('sub-uuid-1');
      expect(result.plan.code).toBe('PHARMACY_PRO');
      expect(result.location?.id).toBe('loc-uuid-1');
    });

    it('acquires the advisory lock before counting workstations and performs every write on the same transaction client', async () => {
      const subscription = buildSubscription();
      const activationCode = buildActivationCode({
        type: 'WORKSTATION',
        subscription,
        locationId: 'loc-uuid-1',
      });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);

      const dto = buildActivateDto({ locationName: undefined });
      await service.activate(dto, REQUEST_IP);

      // Advisory lock ran inside the tx before the count-then-create section
      expect(mockTx.$executeRaw).toHaveBeenCalled();
      expect(mockTx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mockTx.workstationActivation.count.mock.invocationCallOrder[0],
      );

      // Both writes happened on the SAME tx client (the single mockTx handed
      // to the callback), and neither bypassed it through this.prisma.*
      expect(mockTx.workstationActivation.create).toHaveBeenCalledTimes(1);
      expect(mockTx.activationCode.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.workstationActivation.create).not.toHaveBeenCalled();
      expect(mockPrisma.activationCode.update).not.toHaveBeenCalled();
    });

    it('throws INVALID_ACTIVATION_CODE when code is not found', async () => {
      mockPrisma.activationCode.findUnique.mockResolvedValue(null);

      const dto = buildActivateDto();

      await expect(service.activate(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'INVALID_ACTIVATION_CODE',
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('throws ACTIVATION_CODE_USED when code is not UNUSED', async () => {
      const activationCode = buildActivationCode({ status: 'USED' });
      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);

      const dto = buildActivateDto();

      await expect(service.activate(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'ACTIVATION_CODE_USED',
        status: HttpStatus.CONFLICT,
      });
    });

    it('throws ACTIVATION_CODE_EXPIRED when code has expired', async () => {
      const expiredDate = new Date();
      expiredDate.setFullYear(expiredDate.getFullYear() - 1);
      const activationCode = buildActivationCode({ expiresAt: expiredDate });
      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);

      const dto = buildActivateDto();

      await expect(service.activate(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'ACTIVATION_CODE_EXPIRED',
        status: HttpStatus.GONE,
      });
    });

    it('throws SUBSCRIPTION_NOT_ACTIVE when subscription status is not ACTIVE or TRIAL', async () => {
      const subscription = buildSubscription({ status: 'PAST_DUE' });
      const activationCode = buildActivationCode({ subscription });
      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);

      const dto = buildActivateDto();

      await expect(service.activate(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'SUBSCRIPTION_NOT_ACTIVE',
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('throws ACTIVATION_REJECTED_FRAUD when fraud detection rejects', async () => {
      mockFraudDetectionService.runActivationChecks.mockResolvedValue({
        shouldReject: true,
        reason: 'Hardware fingerprint collision detected',
        signals: [{ severity: 'HIGH', reason: 'Collision', detectorName: 'Test', suggestedAction: 'REVOKE' }],
      });

      const subscription = buildSubscription();
      const activationCode = buildActivationCode({ subscription });
      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);

      const dto = buildActivateDto();

      await expect(service.activate(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'ACTIVATION_REJECTED_FRAUD',
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('throws LOCATION_NAME_REQUIRED for SUBSCRIPTION type with no location name and creates nothing', async () => {
      const subscription = buildSubscription();
      const activationCode = buildActivationCode({
        type: 'SUBSCRIPTION',
        subscription,
        locationId: null,
      });
      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);

      const dto = buildActivateDto({ locationName: undefined });

      await expect(service.activate(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'LOCATION_NAME_REQUIRED',
        status: HttpStatus.BAD_REQUEST,
      });
      expect(mockTx.location.create).not.toHaveBeenCalled();
      expect(mockTx.workstationActivation.create).not.toHaveBeenCalled();
      expect(mockTx.activationCode.update).not.toHaveBeenCalled();
      expect(mockLicenseTokenService.generateToken).not.toHaveBeenCalled();
    });

    it('throws WORKSTATION_LIMIT_EXCEEDED when the location already has activeWorkstations equal to the plan limit and creates nothing', async () => {
      const subscription = buildSubscription({
        plan: { ...buildSubscription().plan, maxWorkstationsPerLocation: 1 },
      });
      const activationCode = buildActivationCode({
        type: 'WORKSTATION',
        subscription,
        locationId: 'loc-uuid-1',
      });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);
      mockTx.workstationActivation.count.mockResolvedValue(1);

      const dto = buildActivateDto({ locationName: undefined });

      await expect(service.activate(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'WORKSTATION_LIMIT_EXCEEDED',
        status: HttpStatus.FORBIDDEN,
      });
      expect(mockTx.workstationActivation.create).not.toHaveBeenCalled();
      expect(mockTx.activationCode.update).not.toHaveBeenCalled();
    });

    it('passes requestIp to fraud detection service', async () => {
      const subscription = buildSubscription();
      const activationCode = buildActivationCode({
        type: 'WORKSTATION',
        subscription,
        locationId: 'loc-uuid-1',
      });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);

      const dto = buildActivateDto({ locationName: undefined });
      await service.activate(dto, REQUEST_IP);

      expect(mockFraudDetectionService.runActivationChecks).toHaveBeenCalledWith(
        expect.objectContaining({
          requestIp: REQUEST_IP,
          code: dto.code,
          hardwareFingerprint: dto.hardwareFingerprint,
        }),
      );
    });

    it('uses "unknown" as requestIp when not provided', async () => {
      const subscription = buildSubscription();
      const activationCode = buildActivationCode({
        type: 'WORKSTATION',
        subscription,
        locationId: 'loc-uuid-1',
      });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);

      const dto = buildActivateDto({ locationName: undefined });
      await service.activate(dto);

      expect(mockFraudDetectionService.runActivationChecks).toHaveBeenCalledWith(
        expect.objectContaining({
          requestIp: 'unknown',
        }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // revoke
  // -----------------------------------------------------------------------
  describe('revoke', () => {
    it('revokes an activation', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildWorkstationActivation() as any,
      );
      mockPrisma.workstationActivation.update.mockResolvedValue(
        buildWorkstationActivation({ isActive: false, revokedAt: new Date(), revokedReason: 'Revoked by admin' }) as any,
      );

      const result = await service.revoke('activation-uuid-1');

      expect(mockPrisma.workstationActivation.update).toHaveBeenCalledWith({
        where: { id: 'activation-uuid-1' },
        data: {
          isActive: false,
          revokedAt: expect.any(Date),
          revokedReason: 'Revoked by admin',
        },
      });
      expect(result.isActive).toBe(false);
    });

    it('accepts a custom revoke reason', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildWorkstationActivation() as any,
      );
      mockPrisma.workstationActivation.update.mockResolvedValue({} as any);

      await service.revoke('activation-uuid-1', 'License abuse detected');

      expect(mockPrisma.workstationActivation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            revokedReason: 'License abuse detected',
          }),
        }),
      );
    });

    it('throws ACTIVATION_NOT_FOUND when activation does not exist', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(null);

      await expect(service.revoke('nonexistent-id')).rejects.toMatchObject({
        errorCode: 'ACTIVATION_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  // -----------------------------------------------------------------------
  // getActivationStatus
  // -----------------------------------------------------------------------
  describe('getActivationStatus', () => {
    it('returns activation with includes (subscription, location, check-ins)', async () => {
      const activation = buildWorkstationActivation({
        subscription: { ...buildSubscription(), plan: buildSubscription().plan },
        location: buildLocation(),
        licenseCheckIns: [{ id: 'ci-1', checkedInAt: new Date() }],
      });
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(activation as any);

      const result = await service.getActivationStatus('activation-uuid-1');

      expect(result.id).toBe('activation-uuid-1');
      expect(result.subscription).toBeDefined();
      expect(result.location).toBeDefined();
      expect(result.licenseCheckIns).toHaveLength(1);

      expect(mockPrisma.workstationActivation.findUnique).toHaveBeenCalledWith({
        where: { id: 'activation-uuid-1' },
        include: {
          subscription: { include: { plan: true } },
          location: true,
          licenseCheckIns: { orderBy: { checkedInAt: 'desc' }, take: 10 },
        },
      });
    });

    it('throws ACTIVATION_NOT_FOUND when activation does not exist', async () => {
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(null);

      await expect(service.getActivationStatus('nonexistent-id')).rejects.toMatchObject({
        errorCode: 'ACTIVATION_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });
  });

  // -----------------------------------------------------------------------
  // recoverActivationCodes
  // -----------------------------------------------------------------------
  describe('recoverActivationCodes', () => {
    it('returns the unused SUBSCRIPTION code of every matching ACTIVE subscription', async () => {
      const code = buildActivationCode({
        type: 'SUBSCRIPTION',
        code: 'ABCD-EFGH-IJKL-MNOP5',
      });
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-uuid-1' },
      ] as any);
      mockPrisma.activationCode.findFirst.mockResolvedValue(code as any);

      const result = await service.recoverActivationCodes(
        '900123456',
        'owner@pharmacy.co',
      );

      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith({
        where: {
          customerTaxId: '900123456',
          customerEmail: 'owner@pharmacy.co',
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      expect(mockPrisma.activationCode.findFirst).toHaveBeenCalledWith({
        where: {
          subscriptionId: 'sub-uuid-1',
          type: 'SUBSCRIPTION',
          status: 'UNUSED',
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual({
        codes: [
          {
            code: 'ABCD-EFGH-IJKL-MNOP5',
            expiresAt: code.expiresAt.toISOString(),
          },
        ],
      });
    });

    it('trims the taxId and lowercases the email before querying', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([] as any);

      await service.recoverActivationCodes(
        '  900123456  ',
        'OWNER@PHARMACY.CO',
      );

      expect(mockPrisma.subscription.findMany).toHaveBeenCalledWith({
        where: {
          customerTaxId: '900123456',
          customerEmail: 'owner@pharmacy.co',
          status: 'ACTIVE',
        },
        select: { id: true },
      });
    });

    it('collects codes across multiple subscriptions, skipping those without an unused code', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-uuid-1' },
        { id: 'sub-uuid-2' },
      ] as any);
      mockPrisma.activationCode.findFirst
        .mockResolvedValueOnce(
          buildActivationCode({ type: 'SUBSCRIPTION', code: 'CODE-ONE' }) as any,
        )
        .mockResolvedValueOnce(null);

      const result = await service.recoverActivationCodes(
        '900123456',
        'owner@pharmacy.co',
      );

      expect(result).toEqual({
        codes: [{ code: 'CODE-ONE', expiresAt: expect.any(String) }],
      });
      expect(mockPrisma.activationCode.findFirst).toHaveBeenCalledTimes(2);
    });

    it('returns an empty codes array when no subscription matches', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([] as any);

      await expect(
        service.recoverActivationCodes('900123456', 'owner@pharmacy.co'),
      ).resolves.toEqual({ codes: [] });
      expect(mockPrisma.activationCode.findFirst).not.toHaveBeenCalled();
    });

    it('returns an empty codes array when the matching subscription has no unused codes', async () => {
      mockPrisma.subscription.findMany.mockResolvedValue([
        { id: 'sub-uuid-1' },
      ] as any);
      mockPrisma.activationCode.findFirst.mockResolvedValue(null);

      await expect(
        service.recoverActivationCodes('900123456', 'owner@pharmacy.co'),
      ).resolves.toEqual({ codes: [] });
    });
  });
});
