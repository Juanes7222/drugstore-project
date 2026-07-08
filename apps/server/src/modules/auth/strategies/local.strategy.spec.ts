// Mock @pharmacy/database before any imports that depend on it (import chain:
// local.strategy.ts -> auth.service.ts -> prisma.service.ts -> @pharmacy/database)
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

jest.mock('passport-local', () => ({
  Strategy: jest.fn(),
}));

import { LocalStrategy } from './local.strategy';
import { AuthService } from '../auth.service';

const mockAuthService = {
  validateCredentials: jest.fn(),
} as any;

describe('LocalStrategy', () => {
  let strategy: LocalStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new LocalStrategy(mockAuthService);
  });

  describe('validate', () => {
    it('should call authService.validateCredentials with username and password', async () => {
      const expectedUser = { id: 'user-1', role: 'ADMIN' };
      mockAuthService.validateCredentials.mockResolvedValue(expectedUser);

      const result = await strategy.validate('admin', 'ValidPass123');

      expect(mockAuthService.validateCredentials).toHaveBeenCalledWith(
        'admin',
        'ValidPass123',
      );
      expect(result).toEqual(expectedUser);
    });

    it('should propagate exceptions from authService.validateCredentials', async () => {
      const error = new Error('Invalid credentials');
      mockAuthService.validateCredentials.mockRejectedValue(error);

      await expect(
        strategy.validate('admin', 'WrongPassword'),
      ).rejects.toThrow(error);
    });
  });
});
