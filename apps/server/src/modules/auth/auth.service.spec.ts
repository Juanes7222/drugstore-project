// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return {
    PrismaClient: MockPrismaClient,
    RoleType: {
      SAAS_ADMIN: 'SAAS_ADMIN',
      OWNER: 'OWNER',
      MANAGER: 'MANAGER',
      CASHIER: 'CASHIER',
      INVENTORY_ASSISTANT: 'INVENTORY_ASSISTANT',
      ADMIN: 'ADMIN',
      ACCOUNTANT: 'ACCOUNTANT',
    } as const,
    UserStatus: {
      PENDING_SETUP: 'PENDING_SETUP',
      ACTIVE: 'ACTIVE',
      DISABLED: 'DISABLED',
      LOCKED: 'LOCKED',
    } as const,
    SessionRevocationReason: {
      LOGOUT: 'LOGOUT',
      INACTIVITY: 'INACTIVITY',
      ROLE_CHANGE: 'ROLE_CHANGE',
      USER_DEACTIVATION: 'USER_DEACTIVATION',
      ADMIN_REVOCATION: 'ADMIN_REVOCATION',
      PASSWORD_CHANGED: 'PASSWORD_CHANGED',
      TOKEN_EXPIRATION: 'TOKEN_EXPIRATION',
      NEW_LOGIN_EVICT: 'NEW_LOGIN_EVICT',
      SECURITY_ANOMALY: 'SECURITY_ANOMALY',
      STEP_UP_EXPIRY: 'STEP_UP_EXPIRY',
    } as const,
    AuditAction: {
      CREATE: 'CREATE',
      UPDATE: 'UPDATE',
      DELETE: 'DELETE',
      ACCESS: 'ACCESS',
      EXPORT: 'EXPORT',
      LOGIN: 'LOGIN',
      LOGOUT: 'LOGOUT',
      SECURITY_ALERT: 'SECURITY_ALERT',
      STATE_CHANGE: 'STATE_CHANGE',
    } as const,
    SystemModule: {
      AUTH_USERS: 'AUTH_USERS',
    } as const,
  };
});

import { AuthService } from './auth.service';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';
import { AccountLockedException } from './exceptions/account-locked.exception';
import { AccountInactiveException } from './exceptions/account-inactive.exception';
import { SessionExpiredException } from './exceptions/session-expired.exception';
import { SessionRevokedException } from './exceptions/session-revoked.exception';
import {
  MAX_FAILED_LOGIN_ATTEMPTS,
  ACCOUNT_LOCK_DURATION_MINUTES,
} from './constants/auth.constants';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-uuid-1',
    username: 'admin',
    firstName: 'Admin',
    lastName: 'User',
    email: 'admin@pharmacy.com',
    identificationType: 'CC' as const,
    identificationNumber: '1234567890',
    role: 'ADMIN' as const,
    isActive: true,
    status: 'ACTIVE',
    failedLoginAttempts: 0,
    lockedUntil: null,
    passwordHash: '$argon2id$hashed-value',
    passwordAlgorithm: 'argon2id',
    totpEnabled: false,
    totpSecretEncrypted: null,
    backupCodesHash: null,
    authMethod: 'PASSWORD_ONLY',
    mustChangePassword: false,
    emailVerifiedAt: null,
    lastLoginAt: null,
    lastPasswordChangeAt: null,
    lastLoginWorkstationId: null,
    displayName: 'Admin User',
    fullName: 'Admin User',
    avatarUrl: null,
    avatarColor: null,
    createdById: null,
    subscriptionId: 'sub-uuid-1',
    pinHash: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildActiveSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'session-uuid-1',
    userId: 'user-uuid-1',
    workstationId: 'ws-1',
    tokenHash: 'abc123hash',
    refreshTokenHash: 'def456hash',
    issuedAt: new Date(),
    lastActivityAt: new Date(),
    expiresAt: new Date(Date.now() + 3600000),
    revokedAt: null,
    revokedReason: null,
    ipAddress: '192.168.1.1',
    userAgent: 'test-agent',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// All mocks use `as any` for flexibility in test files — strict typing on mock
// objects is impractical when every method must be a jest.fn() simultaneously
// satisfying both the interface and jest mock API.
const mockUserModel = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  update: jest.fn(),
};

const mockUserLocationAccess = {
  findMany: jest.fn(),
};

const mockPrisma = {
  user: mockUserModel,
  userLocationAccess: mockUserLocationAccess,
  userSession: {
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
} as any;

const mockJwtService = {
  sign: jest.fn(),
} as any;

const mockConfigService = {
  get: jest.fn(),
} as any;

const mockPasswordHasher = {
  hash: jest.fn(),
  verify: jest.fn(),
} as any;

const mockSessionService = {
  createSession: jest.fn(),
  findActiveSessionByTokenHash: jest.fn(),
  findActiveSessionByRefreshTokenHash: jest.fn(),
  revokeSession: jest.fn(),
  revokeUserSessions: jest.fn(),
  touchLastActivity: jest.fn().mockResolvedValue(undefined),
  enforceSessionLimit: jest.fn(),
  updateSessionTokens: jest.fn(),
} as any;

const mockPinService = {
  verify: jest.fn(),
  hash: jest.fn(),
} as any;

const mockTotpService = {
  verify: jest.fn(),
} as any;

const mockBackupCodesService = {
  verify: jest.fn(),
  consume: jest.fn(),
} as any;

const mockAuditService = {
  log: jest.fn(),
} as any;

const mockOfflineTokenService = {
  issueToken: jest.fn(),
  verifyToken: jest.fn(),
  revokeToken: jest.fn(),
  revokeAllUserTokens: jest.fn(),
  revokeAllWorkstationTokens: jest.fn(),
  isRevoked: jest.fn(),
  isUserRevokedSince: jest.fn(),
  getRevocationListSince: jest.fn(),
  getRevocationList: jest.fn(),
  decodeToken: jest.fn(),
} as any;

const mockCredentialCacheService = {
  generateCvk: jest.fn(),
  decryptCvk: jest.fn(),
  getCurrentVersion: jest.fn(),
} as any;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthService', () => {
  let service: AuthService;
  const USER_ID = 'user-uuid-1';
  const USERNAME = 'admin';
  const PASSWORD = 'ValidPass123';

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      mockPrisma,
      mockJwtService,
      mockConfigService,
      mockPasswordHasher,
      mockPinService,
      mockTotpService,
      mockBackupCodesService,
      mockSessionService,
      mockAuditService,
      mockOfflineTokenService,
      mockCredentialCacheService,
    );
  });

  // -----------------------------------------------------------------------
  // validateCredentials
  // -----------------------------------------------------------------------
  describe('validateCredentials', () => {
    it('should return the user record when credentials are valid', async () => {
      const user = buildUser();
      mockUserModel.findFirst.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(true);
      mockUserModel.update.mockResolvedValue(user);

      const result = await service.validateCredentials(USERNAME, PASSWORD);

      expect(result.id).toBe(USER_ID);
    });

    it('should look up user by username or email', async () => {
      mockUserModel.findFirst.mockResolvedValue(buildUser());
      mockPasswordHasher.verify.mockResolvedValue(true);
      mockUserModel.update.mockResolvedValue(buildUser());

      await service.validateCredentials(USERNAME, PASSWORD);

      expect(mockUserModel.findFirst).toHaveBeenCalledWith({
        where: {
          OR: [{ username: USERNAME }, { email: USERNAME }],
        },
      });
    });

    it('should verify password against the stored hash', async () => {
      const user = buildUser();
      mockUserModel.findFirst.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(true);
      mockUserModel.update.mockResolvedValue(user);

      await service.validateCredentials(USERNAME, PASSWORD);

      expect(mockPasswordHasher.verify).toHaveBeenCalledWith(
        user.passwordHash,
        PASSWORD,
      );
    });

    it('should reset failedLoginAttempts on successful login', async () => {
      const user = buildUser({ failedLoginAttempts: 3 });
      mockUserModel.findFirst.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(true);
      mockUserModel.update.mockResolvedValue(user);

      await service.validateCredentials(USERNAME, PASSWORD);

      expect(mockUserModel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: expect.objectContaining({ failedLoginAttempts: 0 }),
        }),
      );
    });

    it('should throw InvalidCredentialsException when user is not found', async () => {
      mockUserModel.findFirst.mockResolvedValue(null);

      await expect(
        service.validateCredentials('nonexistent', PASSWORD),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('should throw AccountInactiveException when user is inactive', async () => {
      const user = buildUser({ isActive: false });
      mockUserModel.findFirst.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, PASSWORD),
      ).rejects.toThrow(AccountInactiveException);
    });

    it('should throw AccountLockedException when account is locked', async () => {
      const future = new Date(Date.now() + 3600000);
      const user = buildUser({ lockedUntil: future });
      mockUserModel.findFirst.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, PASSWORD),
      ).rejects.toThrow(AccountLockedException);
    });

    it('should include lockedUntil in AccountLockedException when account is locked', async () => {
      const future = new Date(Date.now() + 3600000);
      const user = buildUser({ lockedUntil: future });
      mockUserModel.findFirst.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, PASSWORD),
      ).rejects.toMatchObject({ lockedUntil: future });
    });

    it('should throw InvalidCredentialsException when password is wrong', async () => {
      const user = buildUser();
      mockUserModel.findFirst.mockResolvedValue(user);
      mockUserModel.findUnique.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(false);
      mockUserModel.update.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, 'WrongPassword'),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('should increment failedLoginAttempts on wrong password', async () => {
      const user = buildUser({ failedLoginAttempts: 2 });
      mockUserModel.findFirst.mockResolvedValue(user);
      mockUserModel.findUnique.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(false);
      mockUserModel.update.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, 'WrongPassword'),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(mockUserModel.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { failedLoginAttempts: 3 },
      });
    });

    it('should lock account when failed attempts reach the threshold', async () => {
      const user = buildUser({
        failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS - 1,
      });
      mockUserModel.findFirst.mockResolvedValue(user);
      mockUserModel.findUnique.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(false);

      await expect(
        service.validateCredentials(USERNAME, 'WrongPassword'),
      ).rejects.toThrow(AccountLockedException);

      expect(mockUserModel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: USER_ID },
          data: expect.objectContaining({
            failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS,
            lockedUntil: expect.any(Date),
          }),
        }),
      );
    });

    it('should throw AccountLockedException with a lockedUntil ~15 min in the future when lock triggers', async () => {
      const user = buildUser({
        failedLoginAttempts: MAX_FAILED_LOGIN_ATTEMPTS - 1,
      });
      mockUserModel.findFirst.mockResolvedValue(user);
      mockUserModel.findUnique.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(false);

      const before = Date.now();

      await expect(
        service.validateCredentials(USERNAME, 'WrongPassword'),
      ).rejects.toThrow(AccountLockedException);

      const after = Date.now();
      const lockDurationMs = ACCOUNT_LOCK_DURATION_MINUTES * 60 * 1000;
      const updateCall = mockUserModel.update.mock.calls[0][0];
      const lockedUntil: Date = updateCall.data.lockedUntil;
      const diff = lockedUntil.getTime() - before;

      expect(diff).toBeGreaterThanOrEqual(lockDurationMs - 100);
      expect(diff).toBeLessThanOrEqual(lockDurationMs + after - before + 100);
    });

    it('should NOT lock account when failed attempts are below threshold', async () => {
      const user = buildUser({ failedLoginAttempts: 1 });
      mockUserModel.findFirst.mockResolvedValue(user);
      mockUserModel.findUnique.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(false);
      mockUserModel.update.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, 'WrongPassword'),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(mockUserModel.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { failedLoginAttempts: 2 },
      });
      // lockedUntil should NOT have been set
      expect(mockUserModel.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lockedUntil: expect.any(Date) }),
        }),
      );
    });

    it('should silently return when user is not found during handleFailedLoginAttempt', async () => {
      // First call returns null for validateCredentials user lookup
      mockUserModel.findFirst.mockResolvedValue(null);

      await expect(
        service.validateCredentials('nonexistent', 'WrongPassword'),
      ).rejects.toThrow(InvalidCredentialsException);

      expect(mockUserModel.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  // -----------------------------------------------------------------------
  // validateActiveSession
  // -----------------------------------------------------------------------
  describe('validateActiveSession', () => {
    const TOKEN_HASH = 'abc123hash';

    it('should return user DTO when session is active and user exists', async () => {
      const session = buildActiveSession();
      const user = buildUser();
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(session);
      mockUserModel.findUnique.mockResolvedValue(user);

      const result = await service.validateActiveSession(USER_ID, TOKEN_HASH);

      expect(result.id).toBe(USER_ID);
      expect(result.email).toBe(user.email);
    });

    it('should call sessionService.findActiveSessionByTokenHash with the token hash', async () => {
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(
        buildActiveSession(),
      );
      mockUserModel.findUnique.mockResolvedValue(buildUser());

      await service.validateActiveSession(USER_ID, TOKEN_HASH);

      expect(
        mockSessionService.findActiveSessionByTokenHash,
      ).toHaveBeenCalledWith(TOKEN_HASH);
    });

    it('should look up user by userId', async () => {
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(
        buildActiveSession(),
      );
      mockUserModel.findUnique.mockResolvedValue(buildUser());

      await service.validateActiveSession(USER_ID, TOKEN_HASH);

      expect(mockUserModel.findUnique).toHaveBeenCalledWith({
        where: { id: USER_ID },
      });
    });

    it('should throw SessionExpiredException when session is not found', async () => {
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(null);

      await expect(
        service.validateActiveSession(USER_ID, TOKEN_HASH),
      ).rejects.toThrow(SessionExpiredException);
    });

    it('should throw SessionExpiredException when session is not active (findActiveSessionByTokenHash returns null for revoked sessions)', async () => {
      // The session service's findActiveSessionByTokenHash only returns ACTIVE sessions,
      // so revoked sessions result in null from the query, which triggers SessionExpiredException.
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(null);

      await expect(
        service.validateActiveSession(USER_ID, TOKEN_HASH),
      ).rejects.toThrow(SessionExpiredException);
    });

    it('should throw InvalidCredentialsException when user is not found', async () => {
      const session = buildActiveSession();
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(session);
      mockUserModel.findUnique.mockResolvedValue(null);

      await expect(
        service.validateActiveSession(USER_ID, TOKEN_HASH),
      ).rejects.toThrow(InvalidCredentialsException);
    });
  });

  // -----------------------------------------------------------------------
  // issueSession
  // -----------------------------------------------------------------------
  describe('issueSession', () => {
    const WORKSTATION_ID = 'ws-1';
    const IP_ADDRESS = '192.168.1.1';
    const USER_AGENT = 'test-agent';
    const ACCESS_TTL = 900;
    const REFRESH_TTL = 604800;

    const params = {
      userId: USER_ID,
      workstationId: WORKSTATION_ID,
      ipAddress: IP_ADDRESS,
      userAgent: USER_AGENT,
    };

    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_TTL_SECONDS') return ACCESS_TTL;
        if (key === 'JWT_REFRESH_TTL_SECONDS') return REFRESH_TTL;
        return undefined;
      });
      mockJwtService.sign
        .mockReturnValueOnce('access-token-value')
        .mockReturnValueOnce('refresh-token-value');
      mockSessionService.createSession.mockResolvedValue(
        buildActiveSession(),
      );
      mockSessionService.enforceSessionLimit.mockResolvedValue({ evictedSessionId: null });
      mockUserLocationAccess.findMany.mockResolvedValue([
        { locationId: 'loc-1' },
      ]);
      mockOfflineTokenService.issueToken.mockResolvedValue({
        token: 'offline-jwt-value',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        jti: 'offline-jti-uuid',
      });
      mockCredentialCacheService.generateCvk.mockResolvedValue({
        encryptedBlob: 'base64-encrypted-blob',
        keyFingerprint: 'abcdef1234567890',
        version: 1,
      });
    });

    it('should return AuthResponseDto with tokens and user', async () => {
      const user = buildUser();
      mockUserModel.findUnique.mockResolvedValue(user);
      mockUserModel.update.mockResolvedValue(user);

      const result = await service.issueSession(params);

      expect(result).toMatchObject({
        accessToken: 'access-token-value',
        refreshToken: 'refresh-token-value',
        user: expect.objectContaining({ id: USER_ID }),
      });
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('should generate JWT access token with user sub and tokenHash', async () => {
      mockUserModel.findUnique.mockResolvedValue(buildUser());
      mockUserModel.update.mockResolvedValue(buildUser());

      await service.issueSession(params);

      expect(mockJwtService.sign).toHaveBeenCalledTimes(2);
      const accessSignCall = mockJwtService.sign.mock.calls[0];
      expect(accessSignCall[0]).toMatchObject({ sub: USER_ID });
      expect(accessSignCall[0]).toHaveProperty('tokenHash');
      expect(accessSignCall[1]).toEqual({ expiresIn: ACCESS_TTL });
    });

    it('should generate JWT refresh token with sub and refreshTokenHash', async () => {
      mockUserModel.findUnique.mockResolvedValue(buildUser());
      mockUserModel.update.mockResolvedValue(buildUser());

      await service.issueSession(params);

      const refreshSignCall = mockJwtService.sign.mock.calls[1];
      expect(refreshSignCall[0]).toMatchObject({ sub: USER_ID });
      expect(refreshSignCall[0]).toHaveProperty('refreshTokenHash');
      expect(refreshSignCall[1]).toEqual({ expiresIn: REFRESH_TTL });
    });

    it('should throw InvalidCredentialsException when user is not found', async () => {
      mockUserModel.findUnique.mockResolvedValue(null);

      await expect(service.issueSession(params)).rejects.toThrow(
        InvalidCredentialsException,
      );
    });

    it('should create a session via SessionService with correct data', async () => {
      const user = buildUser();
      mockUserModel.findUnique.mockResolvedValue(user);
      mockUserModel.update.mockResolvedValue(user);

      await service.issueSession(params);

      expect(mockSessionService.createSession).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          workstationId: WORKSTATION_ID,
          ipAddress: IP_ADDRESS,
          userAgent: USER_AGENT,
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('should pass a SHA-256 tokenHash to SessionService', async () => {
      const user = buildUser();
      mockUserModel.findUnique.mockResolvedValue(user);
      mockUserModel.update.mockResolvedValue(user);

      await service.issueSession(params);

      const createSessionArg =
        mockSessionService.createSession.mock.calls[0][0];
      // tokenHash fed to session should be a hex string of 64 chars (SHA-256)
      expect(createSessionArg.tokenHash).toMatch(/^[a-f0-9]{64}$/);
      expect(createSessionArg.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('should update user lastLoginAt and lastLoginWorkstationId', async () => {
      const user = buildUser();
      mockUserModel.findUnique.mockResolvedValue(user);
      mockUserModel.update.mockResolvedValue(user);

      await service.issueSession(params);

      expect(mockUserModel.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: {
          lastLoginAt: expect.any(Date),
          lastLoginWorkstationId: WORKSTATION_ID,
        },
      });
    });

    it('should use correct TTLs from config', async () => {
      mockUserModel.findUnique.mockResolvedValue(buildUser());
      mockUserModel.update.mockResolvedValue(buildUser());

      await service.issueSession(params);

      expect(mockConfigService.get).toHaveBeenCalledWith(
        'JWT_ACCESS_TTL_SECONDS',
      );
      expect(mockConfigService.get).toHaveBeenCalledWith(
        'JWT_REFRESH_TTL_SECONDS',
      );
    });

    it('should work without optional ipAddress and userAgent', async () => {
      const user = buildUser();
      mockUserModel.findUnique.mockResolvedValue(user);
      mockUserModel.update.mockResolvedValue(user);

      const minimalParams = {
        userId: USER_ID,
        workstationId: WORKSTATION_ID,
      };

      const result = await service.issueSession(minimalParams);

      expect(result.accessToken).toBe('access-token-value');
    });
  });

  // -----------------------------------------------------------------------
  // logoutSession
  // -----------------------------------------------------------------------
  describe('logoutSession', () => {
    it('should delegate to sessionService.revokeSession with LOGOUT reason', async () => {
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(
        buildActiveSession({ id: 'session-uuid-1' }),
      );
      mockSessionService.revokeSession.mockResolvedValue(
        buildActiveSession({
          revokedAt: new Date(),
          revokedReason: 'LOGOUT',
        }),
      );

      await service.logoutSession('token-hash-value');

      expect(mockSessionService.revokeSession).toHaveBeenCalledWith(
        'session-uuid-1',
        'LOGOUT',
      );
    });

    it('should return silently when session is not found (idempotent)', async () => {
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(null);

      await service.logoutSession('non-existent-hash');

      expect(mockSessionService.revokeSession).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // issueSession — offline artifacts
  // -----------------------------------------------------------------------
  describe('issueSession (offline artifacts)', () => {
    const WORKSTATION_ID = 'ws-1';
    const FINGERPRINT = 'fp-abc123def456';

    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_TTL_SECONDS') return 900;
        if (key === 'JWT_REFRESH_TTL_SECONDS') return 604800;
        return undefined;
      });
      mockJwtService.sign
        .mockReturnValueOnce('access-token-value')
        .mockReturnValueOnce('refresh-token-value');
      mockSessionService.createSession.mockResolvedValue(
        buildActiveSession({ workstationId: WORKSTATION_ID }),
      );
      mockSessionService.enforceSessionLimit.mockResolvedValue({ evictedSessionId: null });
      mockUserModel.findUnique.mockResolvedValue(buildUser());
      mockUserModel.update.mockResolvedValue(buildUser());
      mockUserLocationAccess.findMany.mockResolvedValue([
        { locationId: 'loc-1' },
        { locationId: 'loc-2' },
      ]);
      mockOfflineTokenService.issueToken.mockResolvedValue({
        token: 'offline-jwt-value',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        jti: 'offline-jti-uuid',
      });
      mockCredentialCacheService.generateCvk.mockResolvedValue({
        encryptedBlob: 'base64-encrypted-blob',
        keyFingerprint: 'abcdef1234567890',
        version: 1,
      });
    });

    it('includes offlineToken in the response', async () => {
      const result = await service.issueSession({
        userId: USER_ID,
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(result.offlineToken).toBeDefined();
      expect(result.offlineToken!.token).toBe('offline-jwt-value');
      expect(result.offlineToken!.expiresAt).toBeInstanceOf(Date);
    });

    it('includes credentialVerificationKey in the response', async () => {
      const result = await service.issueSession({
        userId: USER_ID,
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(result.credentialVerificationKey).toBeDefined();
      expect(result.credentialVerificationKey!.encryptedBlob).toBe('base64-encrypted-blob');
      expect(result.credentialVerificationKey!.keyFingerprint).toBe('abcdef1234567890');
      expect(result.credentialVerificationKey!.version).toBe(1);
    });

    it('calls OfflineTokenService.issueToken with correct params', async () => {
      await service.issueSession({
        userId: USER_ID,
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(mockOfflineTokenService.issueToken).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          role: 'ADMIN',
          sessionId: expect.any(String),
          workstationId: WORKSTATION_ID,
          workstationFingerprint: FINGERPRINT,
          locationIds: ['loc-1', 'loc-2'],
        }),
      );
    });

    it('calls CredentialCacheService.generateCvk with correct params', async () => {
      await service.issueSession({
        userId: USER_ID,
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(mockCredentialCacheService.generateCvk).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: USER_ID,
          workstationFingerprint: FINGERPRINT,
          expiresAt: expect.any(Date),
        }),
      );
    });

    it('passes empty fingerprint when hardwareFingerprint is not provided', async () => {
      await service.issueSession({
        userId: USER_ID,
        workstationId: WORKSTATION_ID,
      });

      expect(mockOfflineTokenService.issueToken).toHaveBeenCalledWith(
        expect.objectContaining({
          workstationFingerprint: '',
        }),
      );
      expect(mockCredentialCacheService.generateCvk).toHaveBeenCalledWith(
        expect.objectContaining({
          workstationFingerprint: '',
        }),
      );
    });

    it('audits offline credentials cached event', async () => {
      await service.issueSession({
        userId: USER_ID,
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        'AUTH_OFFLINE_CREDENTIALS_CACHED',
        expect.objectContaining({
          actorId: USER_ID,
          details: expect.objectContaining({
            cvkVersion: 1,
          }),
        }),
      );
    });

    it('audits login success with offline token metadata', async () => {
      await service.issueSession({
        userId: USER_ID,
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        'AUTH_LOGIN_SUCCESS',
        expect.objectContaining({
          details: expect.objectContaining({
            offlineTokenIssued: true,
            offlineTokenExpiresAt: expect.any(String),
          }),
        }),
      );
    });

    it('retrieves user location access for offline token claims', async () => {
      await service.issueSession({
        userId: USER_ID,
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(mockUserLocationAccess.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        select: { locationId: true },
      });
    });
  });

  // -----------------------------------------------------------------------
  // login — offline artifacts
  // -----------------------------------------------------------------------
  describe('login (offline artifacts)', () => {
    const WORKSTATION_ID = 'ws-1';
    const FINGERPRINT = 'fp-abc123def456';
    const USERNAME = 'admin';
    const PASSWORD = 'ValidPass123';

    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_TTL_SECONDS') return 900;
        if (key === 'JWT_REFRESH_TTL_SECONDS') return 604800;
        return undefined;
      });
      mockJwtService.sign
        .mockReturnValueOnce('access-token-value')
        .mockReturnValueOnce('refresh-token-value');
      mockSessionService.createSession.mockResolvedValue(
        buildActiveSession({ workstationId: WORKSTATION_ID }),
      );
      mockSessionService.enforceSessionLimit.mockResolvedValue({ evictedSessionId: null });
      // validateCredentials uses findFirst; handleFailedLoginAttempt uses findUnique
      mockUserModel.findFirst.mockResolvedValue(buildUser());
      mockUserModel.findUnique.mockResolvedValue(buildUser());
      mockUserModel.update.mockResolvedValue(buildUser());
      mockPasswordHasher.verify.mockResolvedValue(true);
      mockUserLocationAccess.findMany.mockResolvedValue([]);
      mockOfflineTokenService.issueToken.mockResolvedValue({
        token: 'offline-jwt-value',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        jti: 'offline-jti-uuid',
      });
      mockCredentialCacheService.generateCvk.mockResolvedValue({
        encryptedBlob: 'base64-encrypted-blob',
        keyFingerprint: 'abcdef1234567890',
        version: 1,
      });
    });

    it('calls OfflineTokenService.issueToken during login', async () => {
      await service.login({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: 'PASSWORD',
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(mockOfflineTokenService.issueToken).toHaveBeenCalled();
    });

    it('calls CredentialCacheService.generateCvk during login', async () => {
      await service.login({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: 'PASSWORD',
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(mockCredentialCacheService.generateCvk).toHaveBeenCalled();
    });

    it('returns offlineToken in login response when no 2FA', async () => {
      const result = await service.login({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: 'PASSWORD',
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(result.offlineToken).toBeDefined();
      expect(result.offlineToken!.token).toBe('offline-jwt-value');
    });

    it('returns credentialVerificationKey in login response when no 2FA', async () => {
      const result = await service.login({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: 'PASSWORD',
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(result.credentialVerificationKey).toBeDefined();
      expect(result.credentialVerificationKey!.encryptedBlob).toBe('base64-encrypted-blob');
    });

    it('returns requiresTwoFactor when TOTP is enabled and skips offline token issuance until 2FA completes', async () => {
      const totpUser = buildUser({ totpEnabled: true }) as Record<string, unknown>;
      mockUserModel.findFirst.mockResolvedValue(totpUser);
      mockUserModel.findUnique.mockResolvedValue(undefined);

      const result = await service.login({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: 'PASSWORD',
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      expect(result.requiresTwoFactor).toBe(true);
      expect(result.offlineToken).toBeUndefined();
      expect(result.credentialVerificationKey).toBeUndefined();

      // Offline token should not have been issued yet
      expect(mockOfflineTokenService.issueToken).not.toHaveBeenCalled();
      expect(mockCredentialCacheService.generateCvk).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // completeTwoFactorLogin
  // -----------------------------------------------------------------------
  describe('completeTwoFactorLogin', () => {
    const WORKSTATION_ID = 'ws-1';
    const FINGERPRINT = 'fp-abc123def456';
    const TOTP_CODE = '123456';

    beforeEach(() => {
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'JWT_ACCESS_TTL_SECONDS') return 900;
        if (key === 'JWT_REFRESH_TTL_SECONDS') return 604800;
        return undefined;
      });
      mockJwtService.sign
        .mockReturnValueOnce('access-token-value')
        .mockReturnValueOnce('refresh-token-value');
      mockSessionService.createSession.mockResolvedValue(
        buildActiveSession({ workstationId: WORKSTATION_ID }),
      );
      mockSessionService.enforceSessionLimit.mockResolvedValue({ evictedSessionId: null });
      mockPasswordHasher.verify.mockResolvedValue(true);
      mockTotpService.verify.mockReturnValue(true);
      mockUserLocationAccess.findMany.mockResolvedValue([]);
      mockOfflineTokenService.issueToken.mockResolvedValue({
        token: 'offline-jwt-value',
        expiresAt: new Date('2026-12-31T23:59:59Z'),
        jti: 'offline-jti-uuid',
      });
      mockCredentialCacheService.generateCvk.mockResolvedValue({
        encryptedBlob: 'base64-encrypted-blob',
        keyFingerprint: 'abcdef1234567890',
        version: 1,
      });
    });

    it('issues offline token and CVK when 2FA succeeds', async () => {
      const totpUser = buildUser({
        totpEnabled: true,
        totpSecretEncrypted: 'encrypted-secret-value',
      }) as Record<string, unknown>;
      mockUserModel.findFirst.mockResolvedValue(totpUser);
      mockUserModel.findUnique.mockResolvedValue(totpUser);

      const loginResult = await service.login({
        identifier: USERNAME,
        secret: PASSWORD,
        sessionType: 'PASSWORD',
        workstationId: WORKSTATION_ID,
        hardwareFingerprint: FINGERPRINT,
      });

      const result = await service.completeTwoFactorLogin({
        challengeToken: loginResult.challengeToken!,
        totpCode: TOTP_CODE,
      });

      expect(result.offlineToken).toBeDefined();
      expect(result.offlineToken!.token).toBe('offline-jwt-value');
      expect(result.credentialVerificationKey).toBeDefined();
      expect(result.credentialVerificationKey!.encryptedBlob).toBe('base64-encrypted-blob');
      expect(mockOfflineTokenService.issueToken).toHaveBeenCalled();
      expect(mockCredentialCacheService.generateCvk).toHaveBeenCalled();
    });
  });
});
