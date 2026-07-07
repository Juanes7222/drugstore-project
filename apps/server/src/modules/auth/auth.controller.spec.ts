// Mock @prisma/client before any imports that depend on it
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthResponseDto } from './dto/auth-response.dto';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildMockUser(overrides: Partial<Record<string, unknown>> = {}) {
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
    workstationId: 'ws-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function buildAuthResponse(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    accessToken: 'jwt-access-token-abc123',
    refreshToken: 'jwt-refresh-token-def456',
    expiresAt: new Date(Date.now() + 900000),
    user: {
      id: 'user-uuid-1',
      username: 'admin',
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@pharmacy.com',
      identificationType: 'CC' as const,
      identificationNumber: '1234567890',
      role: 'ADMIN' as const,
      isActive: true,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuthService = {
  issueSession: jest.fn(),
  validateActiveSession: jest.fn(),
  revokeSession: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuthController (integration)', () => {
  let controller: AuthController;
  let authService: jest.Mocked<typeof mockAuthService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: mockAuthService },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get(AuthService) as jest.Mocked<typeof mockAuthService>;
  });

  // -----------------------------------------------------------------------
  // POST /auth/login
  // -----------------------------------------------------------------------
  describe('POST /auth/login', () => {
    it('should call issueSession with user data and return AuthResponseDto', async () => {
      const user = buildMockUser();
      const workstationId = 'ws-1';
      const clientIp = '192.168.1.1';
      const userAgent = 'test-agent';
      const expectedResponse = buildAuthResponse();

      mockAuthService.issueSession.mockResolvedValue(expectedResponse);

      const result = await controller.login(
        {} as any,
        user as any,
        workstationId,
        clientIp,
        userAgent,
      );

      expect(authService.issueSession).toHaveBeenCalledWith({
        userId: user.id,
        workstationId,
        ipAddress: clientIp,
        userAgent,
      });
      expect(result).toEqual(expectedResponse);
    });

    it('should call issueSession without optional headers when not provided', async () => {
      const user = buildMockUser();
      const workstationId = 'ws-1';
      const expectedResponse = buildAuthResponse();

      mockAuthService.issueSession.mockResolvedValue(expectedResponse);

      const result = await controller.login(
        {} as any,
        user as any,
        workstationId,
        undefined,
        undefined,
      );

      expect(authService.issueSession).toHaveBeenCalledWith({
        userId: user.id,
        workstationId,
        ipAddress: undefined,
        userAgent: undefined,
      });
      expect(result).toEqual(expectedResponse);
    });

    it('should propagate error when authService.issueSession throws', async () => {
      const user = buildMockUser();
      mockAuthService.issueSession.mockRejectedValue(new Error('Session creation failed'));

      await expect(
        controller.login({} as any, user as any, 'ws-1', undefined, undefined),
      ).rejects.toThrow('Session creation failed');
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/refresh
  // -----------------------------------------------------------------------
  describe('POST /auth/refresh', () => {
    it('should throw NotImplementedForPhaseException', async () => {
      const user = buildMockUser();

      await expect(
        controller.refresh(user as any),
      ).rejects.toThrow(NotImplementedForPhaseException);
    });
  });

  // -----------------------------------------------------------------------
  // POST /auth/logout
  // -----------------------------------------------------------------------
  describe('POST /auth/logout', () => {
    it('should throw NotImplementedForPhaseException', async () => {
      const user = buildMockUser();

      await expect(
        controller.logout(user as any),
      ).rejects.toThrow(NotImplementedForPhaseException);
    });
  });

  // -----------------------------------------------------------------------
  // GET /auth/me
  // -----------------------------------------------------------------------
  describe('GET /auth/me', () => {
    it('should return the current user from request', async () => {
      const user = buildMockUser();

      const result = await controller.getCurrentUser(user as any);

      expect(result).toEqual(user);
    });

    it('should return user without sensitive fields removed (handled by service)', async () => {
      const user = buildMockUser({
        passwordHash: 'should-not-be-exposed',
        passwordAlgorithm: 'argon2id',
      });

      const result = await controller.getCurrentUser(user as any);

      // The controller just returns whatever is in request.user — it does not strip fields.
      // The AuthService.mapUserToDto does that during login, but for /me the guard
      // sets request.user from the JWT strategy which already strips sensitive data.
      expect(result).toHaveProperty('id', user.id);
      expect(result).toHaveProperty('username', user.username);
    });
  });
});
