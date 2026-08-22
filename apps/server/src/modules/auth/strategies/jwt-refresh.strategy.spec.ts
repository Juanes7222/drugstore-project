// Mock passport modules before any imports that depend on them. The mocked
// PassportStrategy mixin extends the (mocked) passport-jwt Strategy so the
// options passed to super() land on the Strategy mock and can be asserted.
jest.mock('@nestjs/passport', () => ({
  PassportStrategy: jest.fn().mockImplementation((StrategyClass: any, name?: string) => {
    class MockPassportStrategy extends StrategyClass {
      static registeredName = name;
      constructor(...args: unknown[]) {
        super(...args);
      }
    }
    return MockPassportStrategy;
  }),
}));

jest.mock('passport-jwt', () => ({
  Strategy: jest.fn(),
  ExtractJwt: {
    fromAuthHeaderAsBearerToken: jest.fn(() => jest.fn()),
  },
}));

jest.mock('../services/session.service', () => ({ SessionService: class {} }));

import { jest, describe, it, expect, beforeAll, beforeEach } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { JwtRefreshStrategy } from './jwt-refresh.strategy';

const mockSessionService = {
  findActiveSessionByTokenHash: jest.fn(),
} as any;

const mockConfigService = {
  get: jest.fn(),
} as any;

describe('JwtRefreshStrategy', () => {
  let strategy: JwtRefreshStrategy;

  beforeAll(() => {
    expect(PassportStrategy).toHaveBeenCalledWith(Strategy, 'jwt-refresh');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConfigService.get.mockReturnValue('test-access-secret-32chars!!');
    mockSessionService.findActiveSessionByTokenHash.mockReset();
    strategy = new JwtRefreshStrategy(mockConfigService, mockSessionService);
  });

  describe('constructor', () => {
    it('registers passport with the jwt-refresh strategy name', () => {
      expect((JwtRefreshStrategy as any).registeredName).toBe('jwt-refresh');
    });

    it('passes ignoreExpiration true and the access secret as strategy options', () => {
      expect(Strategy).toHaveBeenCalledWith(
        expect.objectContaining({ ignoreExpiration: true }),
      );
      expect(Strategy).toHaveBeenCalledWith(
        expect.objectContaining({ secretOrKey: 'test-access-secret-32chars!!' }),
      );
      expect(Strategy).toHaveBeenCalledWith(
        expect.objectContaining({ jwtFromRequest: expect.any(Function) }),
      );
      expect(ExtractJwt.fromAuthHeaderAsBearerToken).toHaveBeenCalled();
    });
  });

  describe('validate', () => {
    const payload = { sub: 'user-1', tokenHash: 'hash-1', sessionId: 'session-1' };
    const session = { id: 'session-1', userId: 'user-1' };

    it('throws UnauthorizedException when payload.sub is missing', async () => {
      await expect(
        strategy.validate({ tokenHash: 'hash-1' } as any),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockSessionService.findActiveSessionByTokenHash).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when payload.tokenHash is missing', async () => {
      await expect(
        strategy.validate({ sub: 'user-1' } as any),
      ).rejects.toThrow(UnauthorizedException);

      expect(mockSessionService.findActiveSessionByTokenHash).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when the session lookup returns null', async () => {
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when the session belongs to a different user', async () => {
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue({
        id: 'session-1',
        userId: 'user-other',
      });

      await expect(strategy.validate(payload)).rejects.toThrow(UnauthorizedException);
    });

    it('returns userId, tokenHash and sessionId for a valid session match', async () => {
      mockSessionService.findActiveSessionByTokenHash.mockResolvedValue(session);

      const result = await strategy.validate(payload);

      expect(mockSessionService.findActiveSessionByTokenHash).toHaveBeenCalledWith(
        'hash-1',
      );
      expect(result).toEqual({
        userId: 'user-1',
        tokenHash: 'hash-1',
        sessionId: 'session-1',
      });
    });
  });
});