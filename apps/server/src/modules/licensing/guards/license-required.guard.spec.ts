jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {}
  return { PrismaClient: MockPrismaClient };
});

import { mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';
import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { LicenseRequiredGuard } from './license-required.guard';
import { LicenseTokenService } from '../tokens/license-token.service';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildTokenClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'activation-uuid-1',
    subscriptionId: 'sub-uuid-1',
    subscriptionStatus: 'ACTIVE',
    workstationId: 'activation-uuid-1',
    hardwareFingerprint: 'fp-abc123def456',
    exp: Math.floor(Date.now() / 1000) + 604800,
    iss: 'pharmacy-licensing',
    ...overrides,
  };
}

function buildSubscriptionStatus(overrides: Record<string, unknown> = {}) {
  return { status: 'ACTIVE', ...overrides };
}

function createMockRequest(headers: Record<string, string | undefined> = {}) {
  const request: Record<string, unknown> = { headers: { ...headers } };
  return request;
}

function createMockContext(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({}),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
    getArgs: () => [],
    getArgByIndex: () => ({}),
    switchToRpc: () => ({} as any),
    switchToWs: () => ({} as any),
    getType: () => 'http' as const,
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = mockDeep<PrismaClient>();

const mockLicenseTokenService = {
  verifyToken: jest.fn(),
} as unknown as jest.Mocked<LicenseTokenService>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LicenseRequiredGuard', () => {
  let guard: LicenseRequiredGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new LicenseRequiredGuard(mockPrisma as any, mockLicenseTokenService);
  });

  // -----------------------------------------------------------------------
  // canActivate
  // -----------------------------------------------------------------------
  describe('canActivate', () => {
    it('returns true for valid token and active subscription', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionStatus() as any,
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });

    it('throws ForbiddenException when no license token header', async () => {
      const request = createMockRequest({
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Missing license token');
    });

    it('throws ForbiddenException when no hardware fingerprint header', async () => {
      const request = createMockRequest({
        'x-license-token': 'valid-token',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Missing hardware fingerprint');
    });

    it('throws ForbiddenException when token is expired or invalid', async () => {
      mockLicenseTokenService.verifyToken.mockImplementation(() => {
        throw new Error('Invalid license token');
      });

      const request = createMockRequest({
        'x-license-token': 'expired-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Invalid or expired license token',
      );
    });

    it('throws ForbiddenException when fingerprint does not match token claims', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(
        buildTokenClaims({ hardwareFingerprint: 'fp-different' }),
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow(
        'Hardware fingerprint mismatch',
      );
    });

    it('throws ForbiddenException when subscription is not found', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.subscription.findUnique.mockResolvedValue(null);

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('Subscription not found');
    });

    it('throws ForbiddenException when subscription status is EXPIRED', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionStatus({ status: 'EXPIRED' }) as any,
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('License is expired');
    });

    it('throws ForbiddenException when subscription status is CANCELLED', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionStatus({ status: 'CANCELLED' }) as any,
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('License is cancelled');
    });

    it('throws ForbiddenException when subscription status is SUSPENDED', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionStatus({ status: 'SUSPENDED' }) as any,
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(context)).rejects.toThrow('License is suspended');
    });

    it('attaches licenseClaims and licenseStatus to the request on success', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionStatus() as any,
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await guard.canActivate(context);

      expect(request.licenseClaims).toEqual(
        expect.objectContaining({
          subscriptionId: 'sub-uuid-1',
          hardwareFingerprint: 'fp-abc123def456',
          workstationId: 'activation-uuid-1',
        }),
      );
      expect(request.licenseStatus).toBe('ACTIVE');
    });

    it('sets licenseWarning header to PAST_DUE when subscription is PAST_DUE', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionStatus({ status: 'PAST_DUE' }) as any,
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
      expect(request.licenseWarning).toBe('PAST_DUE');
    });

    it('does not set licenseWarning for ACTIVE subscription', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionStatus() as any,
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await guard.canActivate(context);

      expect(request.licenseWarning).toBeUndefined();
    });

    it('looks up subscription by id from token claims', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(
        buildTokenClaims({ subscriptionId: 'sub-uuid-42' }),
      );
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionStatus() as any,
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      await guard.canActivate(context);

      expect(mockPrisma.subscription.findUnique).toHaveBeenCalledWith({
        where: { id: 'sub-uuid-42' },
        select: { status: true },
      });
    });

    it('allows access for TRIAL subscription status', async () => {
      mockLicenseTokenService.verifyToken.mockReturnValue(buildTokenClaims());
      mockPrisma.subscription.findUnique.mockResolvedValue(
        buildSubscriptionStatus({ status: 'TRIAL' }) as any,
      );

      const request = createMockRequest({
        'x-license-token': 'valid-token',
        'x-hardware-fingerprint': 'fp-abc123def456',
      });
      const context = createMockContext(request);

      const result = await guard.canActivate(context);

      expect(result).toBe(true);
    });
  });
});
