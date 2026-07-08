// Mock @pharmacy/database before any imports that depend on it (import chain:
// jwt.strategy.ts -> auth.service.ts -> prisma.service.ts -> @pharmacy/database)
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

// Mock passport modules before any imports that depend on them
jest.mock('@nestjs/passport', () => ({
  PassportStrategy: jest.fn().mockReturnValue(
    class MockPassportStrategy {
      constructor(...args: unknown[]) {}
    },
  ),
}));

jest.mock('passport-jwt', () => ({
  Strategy: jest.fn(),
  ExtractJwt: {
    fromAuthHeaderAsBearerToken: jest.fn(() => jest.fn()),
  },
}));

import { JwtStrategy } from './jwt.strategy';
import { AuthService } from '../auth.service';

const mockAuthService = {
  validateActiveSession: jest.fn(),
} as any;

const mockConfigService = {
  get: jest.fn(),
} as any;

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('test-access-secret-32chars!');
    strategy = new JwtStrategy(mockConfigService, mockAuthService);
  });

  describe('constructor', () => {
    it('should read JWT_ACCESS_SECRET from config service', () => {
      expect(mockConfigService.get).toHaveBeenCalledWith('JWT_ACCESS_SECRET');
    });
  });

  describe('validate', () => {
    const payload = { sub: 'user-uuid-1', tokenHash: 'abc123hash' };

    it('should call authService.validateActiveSession with sub and tokenHash', async () => {
      const expectedUser = { id: 'user-uuid-1', role: 'ADMIN' };
      mockAuthService.validateActiveSession.mockResolvedValue(expectedUser);

      const result = await strategy.validate(payload);

      expect(
        mockAuthService.validateActiveSession,
      ).toHaveBeenCalledWith('user-uuid-1', 'abc123hash');
      expect(result).toEqual(expectedUser);
    });

    it('should propagate exceptions from authService.validateActiveSession', async () => {
      const error = new Error('Session expired');
      mockAuthService.validateActiveSession.mockRejectedValue(error);

      await expect(strategy.validate(payload)).rejects.toThrow(error);
    });
  });
});
