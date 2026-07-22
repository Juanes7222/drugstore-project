// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {}
  return { PrismaClient: MockPrismaClient };
});

import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { mockDeep, MockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { BlessingService, BlessingRequest } from './blessing.service';
import { OfflineTokenService } from './offline-token.service';
import { AuditService } from '../services/audit.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = mockDeep<PrismaClient>() as MockProxy<PrismaClient>;
const mockJwtService = { sign: jest.fn() } as any;
const mockConfigService = { get: jest.fn() } as any;
const mockAuditService = { log: jest.fn() } as any;

// Stub Prisma delegates that blessing.service accesses
const mockUserModel = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
};
const mockOfflineTokenRevocation = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
};
const mockUserLocationAccess = {
  findMany: jest.fn(),
};
const mockUserSession = {
  create: jest.fn(),
};
const mockWorkstation = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
};
const mockWorkstationActivation = {
  findFirst: jest.fn(),
};
const mockOfflineSessionBlessing = {
  create: jest.fn(),
};

(mockPrisma as any).user = mockUserModel;
(mockPrisma as any).offlineTokenRevocation = mockOfflineTokenRevocation;
(mockPrisma as any).userLocationAccess = mockUserLocationAccess;
(mockPrisma as any).userSession = mockUserSession;
(mockPrisma as any).workstation = mockWorkstation;
(mockPrisma as any).workstationActivation = mockWorkstationActivation;
(mockPrisma as any).offlineSessionBlessing = mockOfflineSessionBlessing;

// OfflineTokenService mock
const mockOfflineTokenService = {
  verifyToken: jest.fn(),
  decodeToken: jest.fn(),
  isRevoked: jest.fn(),
  isUserRevokedSince: jest.fn(),
  revokeToken: jest.fn(),
  issueToken: jest.fn(),
} as any;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildBlessingRequest(overrides: Partial<BlessingRequest> = {}): BlessingRequest {
  return {
    localSessionId: 'local-session-uuid-1',
    userId: 'user-uuid-1',
    offlineTokenJwt: 'valid-offline-jwt-token',
    workstationFingerprint: 'fp-abc123def456',
    createdAt: '2026-06-01T10:00:00Z',
    lastActivityAt: '2026-06-01T11:00:00Z',
    ...overrides,
  };
}

function buildDecodedClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    sub: 'user-uuid-1',
    sid: 'session-uuid-1',
    role: 'CASHIER',
    subscriptionId: 'sub-uuid-1',
    locationIds: ['loc-1', 'loc-2'],
    wfp: 'fp-abc123def456',
    typ: 'offline',
    jti: 'jti-uuid-1',
    iat: now - 3600,
    exp: now + 86400 * 30,
    ...overrides,
  };
}

function buildUserRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-uuid-1',
    isActive: true,
    status: 'ACTIVE',
    role: 'CASHIER',
    subscriptionId: 'sub-uuid-1',
    lockedUntil: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BlessingService', () => {
  let service: BlessingService;
  const REQUEST_FINGERPRINT = 'fp-abc123def456';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BlessingService(
      mockPrisma as unknown as PrismaService,
      mockJwtService,
      mockConfigService,
      mockOfflineTokenService,
      mockAuditService,
    );

    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'JWT_ACCESS_TTL_SECONDS') return 900;
      if (key === 'JWT_REFRESH_TTL_SECONDS') return 604800;
      return undefined;
    });
  });

  // -----------------------------------------------------------------------
  // blessSessions — validation & orchestration
  // -----------------------------------------------------------------------
  describe('blessSessions', () => {
    it('rejects sessions with invalid offline token signatures', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(null);

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toMatchObject({
        localSessionId: 'local-session-uuid-1',
        status: 'REJECTED',
        reason: 'TOKEN_SIGNATURE_INVALID',
      });
    });

    it('rejects expired tokens', async () => {
      const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      mockOfflineTokenService.verifyToken.mockReturnValue(
        buildDecodedClaims({ exp: pastExp }),
      );

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'TOKEN_EXPIRED',
      });
    });

    it('rejects revoked tokens', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims());
      mockOfflineTokenService.isRevoked.mockResolvedValue(true);

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'TOKEN_REVOKED',
      });
    });

    it('rejects workstation fingerprint mismatches and revokes the token', async () => {
      const claims = buildDecodedClaims({ wfp: 'fp-different-workstation' });
      mockOfflineTokenService.verifyToken.mockReturnValue(claims);
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT, // 'fp-abc123def456' — different from claim's wfp
      );

      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'WORKSTATION_FINGERPRINT_MISMATCH',
      });

      // Should have revoked the token
      expect(mockOfflineTokenService.revokeToken).toHaveBeenCalledWith(
        expect.objectContaining({
          jti: claims.jti,
          userId: 'user-uuid-1',
          reason: 'FRAUD_DETECTED',
        }),
      );
    });

    it('rejects disabled users', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims());
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(
        buildUserRecord({ isActive: false, status: 'DISABLED' }),
      );

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'USER_DISABLED',
      });
    });

    it('rejects locked users', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims());
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(
        buildUserRecord({ status: 'LOCKED' }),
      );

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'USER_LOCKED',
      });
    });

    it('rejects users with active lockedUntil timestamp', async () => {
      const futureLock = new Date(Date.now() + 3600000);
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims());
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(
        buildUserRecord({ status: 'ACTIVE', lockedUntil: futureLock }),
      );

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'USER_LOCKED',
      });
    });

    it('rejects when user is not found', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims());
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(null);

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'USER_NOT_FOUND',
      });
    });

    it('rejects users who were revoked since token issuance', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims());
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(buildUserRecord());
      mockOfflineTokenService.isUserRevokedSince.mockResolvedValue(true);

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'USER_DISABLED',
      });
    });

    it('rejects location access revoked users', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims({ locationIds: ['loc-1', 'loc-2'] }));
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(buildUserRecord({ role: 'MANAGER' }));
      mockOfflineTokenService.isUserRevokedSince.mockResolvedValue(false);
      mockUserLocationAccess.findMany.mockResolvedValue([{ locationId: 'loc-1' }]); // Only 1 of 2 locations

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'LOCATION_ACCESS_REVOKED',
      });
    });

    it('blesses valid sessions with fresh tokens', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims());
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(buildUserRecord());
      mockOfflineTokenService.isUserRevokedSince.mockResolvedValue(false);
      mockWorkstationActivation.findFirst.mockResolvedValue({
        id: 'activation-uuid-1',
        isActive: true,
      });
      mockUserLocationAccess.findMany.mockResolvedValue([
        { locationId: 'loc-1' },
        { locationId: 'loc-2' },
      ]);
      mockUserSession.create.mockResolvedValue({ id: 'new-session-uuid' });
      mockOfflineTokenService.issueToken.mockResolvedValue({
        token: 'new-offline-jwt',
        expiresAt: new Date(Date.now() + 86400000 * 30),
        jti: 'new-jti-uuid',
      });
      mockOfflineSessionBlessing.create.mockResolvedValue({});
      mockJwtService.sign.mockReturnValue('new-access-jwt');

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'BLESSED',
        replacementToken: expect.objectContaining({
          accessToken: 'new-access-jwt',
          offlineToken: 'new-offline-jwt',
        }),
      });
    });

    it('handles max 50 sessions per request by truncating', async () => {
      const manyRequests = Array.from({ length: 60 }, (_, i) =>
        buildBlessingRequest({ localSessionId: `session-${i}` }),
      );

      const response = await service.blessSessions(manyRequests, REQUEST_FINGERPRINT);

      // Only 50 should be processed (the rest are truncated before the loop)
      expect(response.results.length).toBeLessThanOrEqual(50);
    });

    it('returns BLESSED for OWNER role without location access check', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims({ locationIds: ['loc-1'] }));
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(
        buildUserRecord({ role: 'OWNER' }),
      );
      mockOfflineTokenService.isUserRevokedSince.mockResolvedValue(false);
      mockWorkstationActivation.findFirst.mockResolvedValue({
        id: 'activation-uuid-1',
        isActive: true,
      });
      mockUserSession.create.mockResolvedValue({ id: 'new-session-uuid' });
      mockOfflineTokenService.issueToken.mockResolvedValue({
        token: 'new-offline-jwt',
        expiresAt: new Date(Date.now() + 86400000 * 14),
        jti: 'new-jti-uuid',
      });
      mockOfflineSessionBlessing.create.mockResolvedValue({});
      mockJwtService.sign.mockReturnValue('new-access-jwt');

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results[0]).toMatchObject({
        status: 'BLESSED',
      });
      // OWNER skips location access check — userLocationAccess.findMany not called after user lookup
      // Note: user is queried twice — once for user record, once for location access check
      // For OWNER, the checkLocationAccess returns true immediately
    });

    it('handles a mix of valid and invalid sessions', async () => {
      // First request: valid
      mockOfflineTokenService.verifyToken
        .mockReturnValueOnce(buildDecodedClaims({ jti: 'jti-valid' }))
        .mockReturnValueOnce(null); // Second request: invalid signature

      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(buildUserRecord());
      mockOfflineTokenService.isUserRevokedSince.mockResolvedValue(false);
      mockWorkstationActivation.findFirst.mockResolvedValue({
        id: 'activation-uuid-1',
        isActive: true,
      });
      mockUserLocationAccess.findMany.mockResolvedValue([
        { locationId: 'loc-1' },
        { locationId: 'loc-2' },
      ]);
      mockUserSession.create.mockResolvedValue({ id: 'new-session-uuid' });
      mockOfflineTokenService.issueToken.mockResolvedValue({
        token: 'new-offline-jwt',
        expiresAt: new Date(Date.now() + 86400000 * 30),
        jti: 'new-jti-uuid',
      });
      mockOfflineSessionBlessing.create.mockResolvedValue({});
      mockJwtService.sign.mockReturnValue('new-access-jwt');

      const requests = [
        buildBlessingRequest({ localSessionId: 'session-valid' }),
        buildBlessingRequest({ localSessionId: 'session-invalid' }),
      ];

      const response = await service.blessSessions(requests, REQUEST_FINGERPRINT);

      expect(response.results).toHaveLength(2);
      expect(response.results[0].status).toBe('BLESSED');
      expect(response.results[1].status).toBe('REJECTED');
    });

    it('records blessing results in the database', async () => {
      mockOfflineTokenService.verifyToken.mockReturnValue(buildDecodedClaims());
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(buildUserRecord());
      mockOfflineTokenService.isUserRevokedSince.mockResolvedValue(false);
      mockWorkstationActivation.findFirst.mockResolvedValue({
        id: 'activation-uuid-1',
        isActive: true,
      });
      mockUserLocationAccess.findMany.mockResolvedValue([
        { locationId: 'loc-1' },
        { locationId: 'loc-2' },
      ]);
      mockUserSession.create.mockResolvedValue({ id: 'new-session-uuid' });
      mockOfflineTokenService.issueToken.mockResolvedValue({
        token: 'new-offline-jwt',
        expiresAt: new Date(Date.now() + 86400000 * 30),
        jti: 'new-jti-uuid',
      });
      mockOfflineSessionBlessing.create.mockResolvedValue({});
      mockJwtService.sign.mockReturnValue('new-access-jwt');

      await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      // Should record the blessing (BLESSED)
      expect(mockOfflineSessionBlessing.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            localSessionId: 'local-session-uuid-1',
            userId: 'user-uuid-1',
            status: 'BLESSED',
          }),
        }),
      );

      // Should audit log the blessing
      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.stringContaining('BLESSED'),
        expect.objectContaining({
          actorId: 'user-uuid-1',
          targetId: 'local-session-uuid-1',
        }),
      );
    });

    it('handles internal errors gracefully without throwing', async () => {
      mockOfflineTokenService.verifyToken.mockImplementation(() => {
        throw new Error('Unexpected error');
      });

      const response = await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      expect(response.results).toHaveLength(1);
      expect(response.results[0]).toMatchObject({
        status: 'REJECTED',
        reason: 'INTERNAL_ERROR',
      });
    });

    it('revokes old offline token after successful blessing', async () => {
      const claims = buildDecodedClaims({ jti: 'old-jti-uuid' });
      mockOfflineTokenService.verifyToken.mockReturnValue(claims);
      mockOfflineTokenService.isRevoked.mockResolvedValue(false);
      mockUserModel.findUnique.mockResolvedValue(buildUserRecord());
      mockOfflineTokenService.isUserRevokedSince.mockResolvedValue(false);
      mockWorkstationActivation.findFirst.mockResolvedValue({
        id: 'activation-uuid-1',
        isActive: true,
      });
      mockUserLocationAccess.findMany.mockResolvedValue([
        { locationId: 'loc-1' },
        { locationId: 'loc-2' },
      ]);
      mockUserSession.create.mockResolvedValue({ id: 'new-session-uuid' });
      mockOfflineTokenService.issueToken.mockResolvedValue({
        token: 'new-offline-jwt',
        expiresAt: new Date(Date.now() + 86400000 * 30),
        jti: 'new-jti-uuid',
      });
      mockOfflineSessionBlessing.create.mockResolvedValue({});
      mockJwtService.sign.mockReturnValue('new-access-jwt');

      await service.blessSessions(
        [buildBlessingRequest()],
        REQUEST_FINGERPRINT,
      );

      // Should revoke the old token after issuing a new one
      expect(mockOfflineTokenService.revokeToken).toHaveBeenCalledWith(
        expect.objectContaining({
          jti: 'old-jti-uuid',
          reason: 'SECURITY_ANOMALY',
          reasonDetail: 'Replaced by blessed session',
        }),
      );
    });
  });
});
