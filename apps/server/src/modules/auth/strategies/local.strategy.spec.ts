// Import chain that depends on @pharmacy/database:
// local.strategy.ts -> auth.service.ts -> prisma.service.ts -> @pharmacy/database
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

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

      await expect(strategy.validate('admin', 'WrongPassword')).rejects.toThrow(
        error,
      );
    });
  });
});
