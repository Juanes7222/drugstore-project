// Mock argon2 before any imports that depend on it
import * as argon2 from 'argon2';

jest.mock('argon2', () => ({
  hash: jest.fn(),
  verify: jest.fn(),
  argon2id: 'argon2id',
}));

import { PasswordHasherService } from './password-hasher.service';

describe('PasswordHasherService', () => {
  let service: PasswordHasherService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PasswordHasherService();
  });

  describe('hash', () => {
    it('should return an object with hash and algorithm properties', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$hashed-value');

      const result = await service.hash('myPassword123');

      expect(result).toEqual({
        hash: '$argon2id$hashed-value',
        algorithm: 'argon2id',
      });
    });

    it('should call argon2.hash with the password and argon2id options', async () => {
      (argon2.hash as jest.Mock).mockResolvedValue('$argon2id$hashed-value');

      await service.hash('myPassword123');

      expect(argon2.hash).toHaveBeenCalledWith('myPassword123', {
        type: 'argon2id',
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
    });

    it('should propagate errors from argon2.hash', async () => {
      (argon2.hash as jest.Mock).mockRejectedValue(new Error('argon2 error'));

      await expect(service.hash('myPassword123')).rejects.toThrow('argon2 error');
    });
  });

  describe('verify', () => {
    it('should return true when password matches the hash', async () => {
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      const result = await service.verify(
        '$argon2id$hashed-value',
        'correctPassword',
      );

      expect(result).toBe(true);
    });

    it('should return false when password does not match the hash', async () => {
      (argon2.verify as jest.Mock).mockResolvedValue(false);

      const result = await service.verify(
        '$argon2id$hashed-value',
        'wrongPassword',
      );

      expect(result).toBe(false);
    });

    it('should call argon2.verify with the hash and password', async () => {
      (argon2.verify as jest.Mock).mockResolvedValue(true);

      await service.verify('$argon2id$hashed-value', 'myPassword123');

      expect(argon2.verify).toHaveBeenCalledWith(
        '$argon2id$hashed-value',
        'myPassword123',
      );
    });

    it('should return false when argon2.verify throws', async () => {
      (argon2.verify as jest.Mock).mockRejectedValue(new Error('invalid hash format'));

      const result = await service.verify(
        'invalid-hash',
        'myPassword123',
      );

      expect(result).toBe(false);
    });
  });
});
