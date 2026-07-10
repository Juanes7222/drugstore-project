jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {}
  return { PrismaClient: MockPrismaClient };
});

import { mockDeep } from 'jest-mock-extended';
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
      const location = buildLocation({ workstationActivations: [] });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription as any);
      mockPrisma.location.findUnique.mockResolvedValue(location as any);
      // The activation code creation — just capture that it was called
      mockPrisma.activationCode.create.mockResolvedValue({ id: 'new-code-uuid' } as any);

      const dto = buildGenerateActivationCodeDto();
      const result = await service.generateActivationCode(SUBSCRIPTION_ID, dto);

      expect(result).toBeDefined();
      expect(mockPrisma.activationCode.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subscriptionId: SUBSCRIPTION_ID,
            locationId: 'loc-uuid-1',
            type: 'WORKSTATION',
            status: 'UNUSED',
          }),
        }),
      );
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

    it('throws WORKSTATION_LIMIT_EXCEEDED when location already has max workstations', async () => {
      const subscription = buildSubscription({
        plan: { ...buildSubscription().plan, maxWorkstationsPerLocation: 2 },
      });
      const location = buildLocation({
        workstationActivations: [
          { isActive: true, id: 'ws-1' },
          { isActive: true, id: 'ws-2' },
        ],
      });
      mockPrisma.subscription.findUnique.mockResolvedValue(subscription as any);
      mockPrisma.location.findUnique.mockResolvedValue(location as any);

      const dto = buildGenerateActivationCodeDto();

      await expect(
        service.generateActivationCode(SUBSCRIPTION_ID, dto),
      ).rejects.toMatchObject({
        errorCode: 'WORKSTATION_LIMIT_EXCEEDED',
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('throws LOCATION_NOT_FOUND when locationId does not exist', async () => {
      mockPrisma.subscription.findUnique.mockResolvedValue(buildSubscription() as any);
      mockPrisma.location.findUnique.mockResolvedValue(null);

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
      mockPrisma.location.findUnique.mockResolvedValue(
        buildLocation({ subscriptionId: 'other-sub-uuid' }) as any,
      );

      const dto = buildGenerateActivationCodeDto();

      await expect(
        service.generateActivationCode(SUBSCRIPTION_ID, dto),
      ).rejects.toMatchObject({
        errorCode: 'LOCATION_MISMATCH',
        status: HttpStatus.FORBIDDEN,
      });
    });
  });

  // -----------------------------------------------------------------------
  // activate
  // -----------------------------------------------------------------------
  describe('activate', () => {
    const REQUEST_IP = '192.168.1.100';
    const futureExpiry = new Date();
    futureExpiry.setFullYear(futureExpiry.getFullYear() + 1);

    beforeEach(() => {
      // Default fraud check passes
      mockFraudDetectionService.runActivationChecks.mockResolvedValue({
        shouldReject: false,
        reason: null,
        signals: [],
      });
      // Default token
      mockLicenseTokenService.generateToken.mockReturnValue(buildTokenResult());
      // Default activation code creation
      mockPrisma.activationCode.update.mockResolvedValue({} as any);
      mockPrisma.workstationActivation.create.mockResolvedValue(
        buildWorkstationActivation() as any,
      );
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
      mockPrisma.location.create.mockResolvedValue(newLocation as any);
      mockPrisma.location.findUnique.mockResolvedValue(newLocation as any);

      const dto = buildActivateDto({ locationName: 'New Store' });
      const result = await service.activate(dto, REQUEST_IP);

      // Location was created (address, city, region default to null from DTO)
      expect(mockPrisma.location.create).toHaveBeenCalledWith(
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

      // Activation was created
      expect(mockPrisma.workstationActivation.create).toHaveBeenCalled();

      // Code was marked as used
      expect(mockPrisma.activationCode.update).toHaveBeenCalled();

      // Token was generated
      expect(mockLicenseTokenService.generateToken).toHaveBeenCalled();

      // Response shape
      expect(result.activationToken).toBe('signed-jwt-token-string');
      expect(result.subscription.id).toBe('sub-uuid-1');
      expect(result.location).not.toBeNull();
      expect(result.plan.code).toBe('PHARMACY_PRO');
    });

    it('fully activates a WORKSTATION type (uses existing location)', async () => {
      const subscription = buildSubscription();
      const activationCode = buildActivationCode({
        type: 'WORKSTATION',
        subscription,
        locationId: 'loc-uuid-1',
      });
      const location = buildLocation({ workstationActivations: [] });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);
      mockPrisma.location.findUnique.mockResolvedValue(location as any);

      const dto = buildActivateDto({ locationName: undefined });
      const result = await service.activate(dto, REQUEST_IP);

      // No location was created
      expect(mockPrisma.location.create).not.toHaveBeenCalled();

      // Activation was created
      expect(mockPrisma.workstationActivation.create).toHaveBeenCalledWith(
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

    it('throws LOCATION_NAME_REQUIRED for SUBSCRIPTION type with no location name', async () => {
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
    });

    it('throws WORKSTATION_LIMIT_EXCEEDED when location is at capacity', async () => {
      const subscription = buildSubscription({
        plan: { ...buildSubscription().plan, maxWorkstationsPerLocation: 1 },
      });
      const activationCode = buildActivationCode({
        type: 'WORKSTATION',
        subscription,
        locationId: 'loc-uuid-1',
      });
      const location = buildLocation({
        workstationActivations: [{ isActive: true, id: 'ws-1' }],
      });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);
      mockPrisma.location.findUnique.mockResolvedValue(location as any);

      const dto = buildActivateDto({ locationName: undefined });

      await expect(service.activate(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'WORKSTATION_LIMIT_EXCEEDED',
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('passes requestIp to fraud detection service', async () => {
      const subscription = buildSubscription();
      const activationCode = buildActivationCode({
        type: 'WORKSTATION',
        subscription,
        locationId: 'loc-uuid-1',
      });
      const location = buildLocation({ workstationActivations: [] });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);
      mockPrisma.location.findUnique.mockResolvedValue(location as any);

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
      const location = buildLocation({ workstationActivations: [] });

      mockPrisma.activationCode.findUnique.mockResolvedValue(activationCode as any);
      mockPrisma.location.findUnique.mockResolvedValue(location as any);

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
});
