// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
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
    failedLoginAttempts: 0,
    lockedUntil: null,
    passwordHash: '$argon2id$hashed-value',
    passwordAlgorithm: 'argon2id',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  } as const;
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
  update: jest.fn(),
};

const mockPrisma = {
  user: mockUserModel,
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
  revokeSession: jest.fn(),
  touchLastActivity: jest.fn(),
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
      mockSessionService,
    );
  });

  // -----------------------------------------------------------------------
  // validateCredentials
  // -----------------------------------------------------------------------
  describe('validateCredentials', () => {
    it('should return user DTO when credentials are valid', async () => {
      const user = buildUser();
      mockUserModel.findUnique.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(true);
      mockUserModel.update.mockResolvedValue(user);

      const result = await service.validateCredentials(USERNAME, PASSWORD);

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('passwordAlgorithm');
      expect(result.id).toBe(USER_ID);
    });

    it('should look up user by username', async () => {
      mockUserModel.findUnique.mockResolvedValue(buildUser());
      mockPasswordHasher.verify.mockResolvedValue(true);
      mockUserModel.update.mockResolvedValue(buildUser());

      await service.validateCredentials(USERNAME, PASSWORD);

      expect(mockUserModel.findUnique).toHaveBeenCalledWith({
        where: { username: USERNAME },
      });
    });

    it('should verify password against the stored hash', async () => {
      const user = buildUser();
      mockUserModel.findUnique.mockResolvedValue(user);
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
      mockUserModel.findUnique.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(true);
      mockUserModel.update.mockResolvedValue(user);

      await service.validateCredentials(USERNAME, PASSWORD);

      expect(mockUserModel.update).toHaveBeenCalledWith({
        where: { id: USER_ID },
        data: { failedLoginAttempts: 0 },
      });
    });

    it('should throw InvalidCredentialsException when user is not found', async () => {
      mockUserModel.findUnique.mockResolvedValue(null);

      await expect(
        service.validateCredentials('nonexistent', PASSWORD),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('should throw AccountInactiveException when user is inactive', async () => {
      const user = buildUser({ isActive: false });
      mockUserModel.findUnique.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, PASSWORD),
      ).rejects.toThrow(AccountInactiveException);
    });

    it('should throw AccountLockedException when account is locked', async () => {
      const future = new Date(Date.now() + 3600000);
      const user = buildUser({ lockedUntil: future });
      mockUserModel.findUnique.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, PASSWORD),
      ).rejects.toThrow(AccountLockedException);
    });

    it('should include lockedUntil in AccountLockedException when account is locked', async () => {
      const future = new Date(Date.now() + 3600000);
      const user = buildUser({ lockedUntil: future });
      mockUserModel.findUnique.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, PASSWORD),
      ).rejects.toMatchObject({ lockedUntil: future });
    });

    it('should throw InvalidCredentialsException when password is wrong', async () => {
      const user = buildUser();
      mockUserModel.findUnique.mockResolvedValue(user);
      mockPasswordHasher.verify.mockResolvedValue(false);
      mockUserModel.update.mockResolvedValue(user);

      await expect(
        service.validateCredentials(USERNAME, 'WrongPassword'),
      ).rejects.toThrow(InvalidCredentialsException);
    });

    it('should increment failedLoginAttempts on wrong password', async () => {
      const user = buildUser({ failedLoginAttempts: 2 });
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
      mockUserModel.findUnique.mockResolvedValue(null);

      await expect(
        service.validateCredentials('nonexistent', 'WrongPassword'),
      ).rejects.toThrow(InvalidCredentialsException);

      // findUnique was only called once (by assertAccountIsUsable)
      // handleFailedLoginAttempt should have returned early since user doesn't exist
      expect(mockUserModel.findUnique).toHaveBeenCalledTimes(1);
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

      expect(result).not.toHaveProperty('passwordHash');
      expect(result).not.toHaveProperty('passwordAlgorithm');
      expect(result.id).toBe(USER_ID);
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

    it('should throw SessionRevokedException when session is revoked', async () => {
      const revokedSession = buildActiveSession({
        revokedAt: new Date(),
        revokedReason: 'LOGOUT',
      });
      // Simulate the scenario where findActiveSessionByTokenHash returns a session
      // (edge case guard in auth service — dead code but tested as-is)
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(
        revokedSession,
      );

      await expect(
        service.validateActiveSession(USER_ID, TOKEN_HASH),
      ).rejects.toThrow(SessionRevokedException);
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
  // revokeSession
  // -----------------------------------------------------------------------
  describe('revokeSession', () => {
    it('should delegate to sessionService.revokeSession with LOGOUT reason', async () => {
      mockSessionService.revokeSession.mockResolvedValue(
        buildActiveSession({
          revokedAt: new Date(),
          revokedReason: 'LOGOUT',
        }),
      );

      await service.revokeSession('session-uuid-1');

      expect(mockSessionService.revokeSession).toHaveBeenCalledWith(
        'session-uuid-1',
        'LOGOUT',
      );
    });
  });
});
