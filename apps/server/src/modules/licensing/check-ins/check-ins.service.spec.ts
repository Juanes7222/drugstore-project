jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {}
  return { PrismaClient: MockPrismaClient };
});

import { mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { HttpStatus } from '@nestjs/common';
import { CheckInsService } from './check-ins.service';
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
    ...overrides,
  };
}

function buildActivation(overrides: Record<string, unknown> = {}) {
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
    subscription: buildSubscription(),
    location: buildLocation(),
    ...overrides,
  };
}

function buildCheckInDto(overrides: Record<string, unknown> = {}) {
  return {
    activationToken: 'valid-jwt-token',
    hardwareFingerprint: 'fp-abc123def456',
    ...overrides,
  };
}

function buildCheckInRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'checkin-uuid-1',
    workstationActivationId: 'activation-uuid-1',
    subscriptionId: 'sub-uuid-1',
    ipAddress: '192.168.1.100',
    hardwareFingerprint: 'fp-abc123def456',
    tokenExpiresAt: new Date(Date.now() + 604800000),
    checkedInAt: new Date(),
    ...overrides,
  };
}

function buildTokenResult(tokenOverrides: Record<string, unknown> = {}) {
  return {
    token: 'new-signed-jwt-token',
    expiresAt: new Date(Date.now() + 604800000).toISOString(),
    ...tokenOverrides,
  };
}

function buildTokenClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'activation-uuid-1',
    subscriptionId: 'sub-uuid-1',
    workstationId: 'activation-uuid-1',
    hardwareFingerprint: 'fp-abc123def456',
    exp: Math.floor(Date.now() / 1000) + 604800,
    iss: 'pharmacy-licensing',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = mockDeep<PrismaClient>();

const mockLicenseTokenService = {
  verifyToken: jest.fn(),
  generateToken: jest.fn(),
} as unknown as jest.Mocked<LicenseTokenService>;

const mockFraudDetectionService = {
  reportTokenReplay: jest.fn(),
  runCheckInChecks: jest.fn(),
} as unknown as jest.Mocked<FraudDetectionService>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CheckInsService', () => {
  let service: CheckInsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CheckInsService(
      mockPrisma as any,
      mockLicenseTokenService,
      mockFraudDetectionService,
    );
  });

  // -----------------------------------------------------------------------
  // checkIn
  // -----------------------------------------------------------------------
  describe('checkIn', () => {
    const REQUEST_IP = '192.168.1.100';
    const futureTokenExpiry = new Date(Date.now() + 604800000);

    function setupActiveSubscription() {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockLicenseTokenService.generateToken.mockReturnValue(buildTokenResult());
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildActivation() as any,
      );
      // No recent check-in (dedup window miss)
      mockPrisma.licenseCheckIn.findFirst.mockResolvedValue(null);
      mockPrisma.licenseCheckIn.create.mockResolvedValue(buildCheckInRecord() as any);
      mockPrisma.workstationActivation.update.mockResolvedValue({} as any);
    }

    it('successfully processes check-in with ACTIVE subscription', async () => {
      setupActiveSubscription();

      const dto = buildCheckInDto();
      const result = await service.checkIn(dto, REQUEST_IP);

      expect(result.licenseStatus).toBe('ACTIVE');
      expect(result.activationToken).toBe('new-signed-jwt-token');
      expect(result.expiresAt).toBeTruthy();
      expect(result.subscription.id).toBe('sub-uuid-1');
      expect(result.daysUntilGracePeriodEnd).toBeNull();
    });

    it('throws INVALID_LICENSE_TOKEN when token verification fails', async () => {
      mockLicenseTokenService.verifyToken.mockImplementation(() => {
        throw new Error('Invalid license token');
      });

      const dto = buildCheckInDto();

      await expect(service.checkIn(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'INVALID_LICENSE_TOKEN',
        status: HttpStatus.UNAUTHORIZED,
      });
    });

    it('throws ACTIVATION_NOT_FOUND when workstation activation is not found', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(null);

      const dto = buildCheckInDto();

      await expect(service.checkIn(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'ACTIVATION_NOT_FOUND',
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('throws ACTIVATION_REVOKED when activation is not active', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildActivation({ isActive: false, revokedAt: new Date(), revokedReason: 'Revoked by admin' }) as any,
      );

      const dto = buildCheckInDto();

      await expect(service.checkIn(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'ACTIVATION_REVOKED',
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('throws FINGERPRINT_MISMATCH and reports token replay when fingerprints differ', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(
        buildTokenClaims({ hardwareFingerprint: 'fp-different-wsid' }),
      );
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildActivation({ hardwareFingerprint: 'fp-original' }) as any,
      );
      mockFraudDetectionService.reportTokenReplay.mockResolvedValue(undefined);

      const dto = buildCheckInDto({ hardwareFingerprint: 'fp-different-wsid' });

      await expect(service.checkIn(dto, REQUEST_IP)).rejects.toMatchObject({
        errorCode: 'FINGERPRINT_MISMATCH',
        status: HttpStatus.FORBIDDEN,
      });

      expect(mockFraudDetectionService.reportTokenReplay).toHaveBeenCalledWith(
        expect.objectContaining({
          activationId: 'activation-uuid-1',
          expectedFingerprint: 'fp-original',
          receivedFingerprint: 'fp-different-wsid',
        }),
      );
    });

    it('returns GRACE_PERIOD for PAST_DUE within grace period', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 3); // 3 days past due
      const subscription = buildSubscription({
        status: 'PAST_DUE',
        currentPeriodEnd: pastDue,
        gracePeriodDays: 7, // 7 day grace → still within
      });

      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockLicenseTokenService.generateToken
        .mockReturnValueOnce(buildTokenResult({ expiresAt: new Date(Date.now() + 345600000).toISOString() })) // for tokenExpiresAt
        .mockReturnValueOnce(buildTokenResult({ token: 'grace-token' })); // for response
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildActivation({ subscription, location: buildLocation() }) as any,
      );
      // Dedup — no recent check-in
      mockPrisma.licenseCheckIn.findFirst.mockResolvedValue(null);
      mockPrisma.licenseCheckIn.create.mockResolvedValue(buildCheckInRecord() as any);
      mockPrisma.workstationActivation.update.mockResolvedValue({} as any);

      const dto = buildCheckInDto();
      const result = await service.checkIn(dto, REQUEST_IP);

      expect(result.licenseStatus).toBe('GRACE_PERIOD');
      expect(result.activationToken).toBe('grace-token');
      expect(result.daysUntilGracePeriodEnd).toBeGreaterThan(0);
    });

    it('returns LOCKED when PAST_DUE is beyond grace period', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 10); // 10 days past due
      const subscription = buildSubscription({
        status: 'PAST_DUE',
        currentPeriodEnd: pastDue,
        gracePeriodDays: 7, // 7 day grace → expired
      });

      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockLicenseTokenService.generateToken.mockReturnValue(buildTokenResult());
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildActivation({ subscription, location: buildLocation() }) as any,
      );
      // Dedup — no recent check-in
      mockPrisma.licenseCheckIn.findFirst.mockResolvedValue(null);
      mockPrisma.licenseCheckIn.create.mockResolvedValue(buildCheckInRecord() as any);
      mockPrisma.workstationActivation.update.mockResolvedValue({} as any);

      const dto = buildCheckInDto();
      const result = await service.checkIn(dto, REQUEST_IP);

      expect(result.licenseStatus).toBe('LOCKED');
      expect(result.activationToken).toBeNull();
      expect(result.daysUntilGracePeriodEnd).toBeNull();
    });

    it('deduplicates within 5-minute window and returns same status', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockLicenseTokenService.generateToken.mockReturnValue(buildTokenResult());
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildActivation() as any,
      );
      // A recent check-in exists → dedup hit
      mockPrisma.licenseCheckIn.findFirst.mockResolvedValue(buildCheckInRecord() as any);

      const dto = buildCheckInDto();
      const result = await service.checkIn(dto, REQUEST_IP);

      // No new check-in was created
      expect(mockPrisma.licenseCheckIn.create).not.toHaveBeenCalled();
      expect(mockPrisma.workstationActivation.update).not.toHaveBeenCalled();

      // Still returns the normal response
      expect(result.licenseStatus).toBe('ACTIVE');
    });

    it('runs fraud check-in detectors during check-in', async () => {
      setupActiveSubscription();

      const dto = buildCheckInDto();
      await service.checkIn(dto, REQUEST_IP);

      expect(mockFraudDetectionService.runCheckInChecks).toHaveBeenCalledWith(
        expect.objectContaining({
          activationId: 'activation-uuid-1',
          subscriptionId: 'sub-uuid-1',
          hardwareFingerprint: 'fp-abc123def456',
          requestIp: REQUEST_IP,
        }),
      );
    });

    it('uses "unknown" as requestIp when not provided', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockLicenseTokenService.generateToken.mockReturnValue(buildTokenResult());
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildActivation() as any,
      );
      mockPrisma.licenseCheckIn.findFirst.mockResolvedValue(null);
      mockPrisma.licenseCheckIn.create.mockResolvedValue(buildCheckInRecord() as any);
      mockPrisma.workstationActivation.update.mockResolvedValue({} as any);

      const dto = buildCheckInDto();
      await service.checkIn(dto);

      expect(mockFraudDetectionService.runCheckInChecks).toHaveBeenCalledWith(
        expect.objectContaining({
          requestIp: 'unknown',
        }),
      );
    });

    it('updates activation lastCheckInAt and checkInCount on successful check-in', async () => {
      setupActiveSubscription();

      const dto = buildCheckInDto();
      await service.checkIn(dto, REQUEST_IP);

      expect(mockPrisma.workstationActivation.update).toHaveBeenCalledWith({
        where: { id: 'activation-uuid-1' },
        data: {
          lastCheckInAt: expect.any(Date),
          lastCheckInIp: REQUEST_IP,
          checkInCount: { increment: 1 },
        },
      });
    });

    it('includes subscription info in the response for LOCKED status', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 10);
      const subscription = buildSubscription({
        status: 'PAST_DUE',
        currentPeriodEnd: pastDue,
        gracePeriodDays: 7,
      });

      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildActivation({ subscription }) as any,
      );
      mockPrisma.licenseCheckIn.findFirst.mockResolvedValue(null);
      mockPrisma.licenseCheckIn.create.mockResolvedValue(buildCheckInRecord() as any);
      mockPrisma.workstationActivation.update.mockResolvedValue({} as any);

      const dto = buildCheckInDto();
      const result = await service.checkIn(dto, REQUEST_IP);

      expect(result.subscription.status).toBe('PAST_DUE');
      expect(result.subscription.currentPeriodEnd).toEqual(subscription.currentPeriodEnd);
      expect(result.subscription.gracePeriodDays).toBe(7);
    });

    it('does not call generateToken when status is LOCKED', async () => {
      const pastDue = new Date();
      pastDue.setDate(pastDue.getDate() - 10);
      const subscription = buildSubscription({
        status: 'PAST_DUE',
        currentPeriodEnd: pastDue,
        gracePeriodDays: 7,
      });

      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.workstationActivation.findUnique.mockResolvedValue(
        buildActivation({ subscription }) as any,
      );
      mockPrisma.licenseCheckIn.findFirst.mockResolvedValue(null);
      mockPrisma.licenseCheckIn.create.mockResolvedValue(buildCheckInRecord() as any);
      mockPrisma.workstationActivation.update.mockResolvedValue({} as any);

      const dto = buildCheckInDto();
      await service.checkIn(dto, REQUEST_IP);

      // generateToken should NOT have been called for LOCKED status
      expect(mockLicenseTokenService.generateToken).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // getCheckInHistory
  // -----------------------------------------------------------------------
  describe('getCheckInHistory', () => {
    it('returns check-in list for an activation', async () => {
      const checkIns = [
        buildCheckInRecord({ id: 'ci-1', checkedInAt: new Date('2026-06-15T10:00:00Z') }),
        buildCheckInRecord({ id: 'ci-2', checkedInAt: new Date('2026-06-15T09:00:00Z') }),
      ];
      mockPrisma.licenseCheckIn.findMany.mockResolvedValue(checkIns as any);

      const result = await service.getCheckInHistory('activation-uuid-1', 5);

      expect(result).toHaveLength(2);
      expect(mockPrisma.licenseCheckIn.findMany).toHaveBeenCalledWith({
        where: { workstationActivationId: 'activation-uuid-1' },
        orderBy: { checkedInAt: 'desc' },
        take: 5,
      });
    });

    it('defaults limit to 10', async () => {
      mockPrisma.licenseCheckIn.findMany.mockResolvedValue([]);

      await service.getCheckInHistory('activation-uuid-1');

      expect(mockPrisma.licenseCheckIn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10 }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // getCheckInCountSince
  // -----------------------------------------------------------------------
  describe('getCheckInCountSince', () => {
    it('returns count of check-ins since a given date', async () => {
      const since = new Date('2026-06-15T00:00:00Z');
      mockPrisma.licenseCheckIn.count.mockResolvedValue(5);

      const result = await service.getCheckInCountSince('activation-uuid-1', since);

      expect(result).toBe(5);
      expect(mockPrisma.licenseCheckIn.count).toHaveBeenCalledWith({
        where: {
          workstationActivationId: 'activation-uuid-1',
          checkedInAt: { gte: since },
        },
      });
    });

    it('returns 0 when no check-ins exist since the date', async () => {
      const since = new Date('2026-06-15T00:00:00Z');
      mockPrisma.licenseCheckIn.count.mockResolvedValue(0);

      const result = await service.getCheckInCountSince('activation-uuid-1', since);

      expect(result).toBe(0);
    });
  });
});
