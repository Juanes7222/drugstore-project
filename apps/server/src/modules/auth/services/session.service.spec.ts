// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return {
    PrismaClient: MockPrismaClient,
    SessionStatus: { ACTIVE: 'ACTIVE', REVOKED: 'REVOKED', EXPIRED: 'EXPIRED' },
    SessionRevocationReason: { LOGOUT: 'LOGOUT' },
  };
});

import { SessionService } from './session.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

const mockUserSession = {
  create: jest.fn(),
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  update: jest.fn(),
};

const mockPrisma = {
  userSession: mockUserSession,
} as unknown as PrismaService;

function buildActiveSession(overrides: Record<string, unknown> = {}) {
  const future = new Date(Date.now() + 3600000);
  return {
    id: 'session-uuid-1',
    userId: 'user-uuid-1',
    workstationId: 'ws-1',
    tokenHash: 'abc123hash',
    refreshTokenHash: 'def456hash',
    issuedAt: new Date(),
    lastActivityAt: new Date(),
    expiresAt: future,
    revokedAt: null,
    revokedReason: null,
    ipAddress: '192.168.1.1',
    userAgent: 'test-agent',
    ...overrides,
  };
}

describe('SessionService', () => {
  let service: SessionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SessionService(mockPrisma);
  });

  describe('createSession', () => {
    const future = new Date(Date.now() + 3600000);
    const params = {
      userId: 'user-uuid-1',
      workstationId: 'ws-1',
      tokenHash: 'abc123hash',
      refreshTokenHash: 'def456hash',
      expiresAt: future,
      ipAddress: '192.168.1.1',
      userAgent: 'test-agent',
    };

    it('should create a user session with the provided data', async () => {
      const expectedSession = buildActiveSession();
      mockUserSession.create.mockResolvedValue(expectedSession);

      const result = await service.createSession(params);

      expect(result).toEqual(expectedSession);
    });

    it('should call prisma.userSession.create with correct data shape', async () => {
      mockUserSession.create.mockResolvedValue(buildActiveSession());

      await service.createSession(params);

      const createCall = mockUserSession.create.mock.calls[0][0];
      expect(createCall.data).toMatchObject({
        userId: 'user-uuid-1',
        workstationId: 'ws-1',
        tokenHash: 'abc123hash',
        refreshTokenHash: 'def456hash',
        expiresAt: future,
        ipAddress: '192.168.1.1',
        userAgent: 'test-agent',
      });
    });

    it('should generate an id using crypto.randomUUID pattern (uuid format)', async () => {
      mockUserSession.create.mockResolvedValue(buildActiveSession());

      await service.createSession(params);

      const createCall = mockUserSession.create.mock.calls[0][0];
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(createCall.data.id).toMatch(uuidRegex);
    });

    it('should set issuedAt and lastActivityAt to a Date object', async () => {
      mockUserSession.create.mockResolvedValue(buildActiveSession());

      await service.createSession(params);

      const createCall = mockUserSession.create.mock.calls[0][0];
      expect(createCall.data.issuedAt).toBeInstanceOf(Date);
      expect(createCall.data.lastActivityAt).toBeInstanceOf(Date);
    });

    it('should set ipAddress to null when not provided', async () => {
      const paramsWithoutIp = { ...params, ipAddress: undefined };
      mockUserSession.create.mockResolvedValue(buildActiveSession());

      await service.createSession(paramsWithoutIp);

      const createCall = mockUserSession.create.mock.calls[0][0];
      expect(createCall.data.ipAddress).toBeNull();
    });

    it('should set userAgent to null when not provided', async () => {
      const paramsWithoutAgent = { ...params, userAgent: undefined };
      mockUserSession.create.mockResolvedValue(buildActiveSession());

      await service.createSession(paramsWithoutAgent);

      const createCall = mockUserSession.create.mock.calls[0][0];
      expect(createCall.data.userAgent).toBeNull();
    });
  });

  describe('findActiveSessionByTokenHash', () => {
    it('should return the session when it is active and not expired', async () => {
      const session = buildActiveSession();
      mockUserSession.findFirst.mockResolvedValue(session);

      const result = await service.findActiveSessionByTokenHash('abc123hash');

      expect(result).toEqual(session);
    });

    it('should call findFirst with the provided tokenHash and active status', async () => {
      mockUserSession.findFirst.mockResolvedValue(buildActiveSession());

      await service.findActiveSessionByTokenHash('abc123hash');

      expect(mockUserSession.findFirst).toHaveBeenCalledWith({
        where: {
          tokenHash: 'abc123hash',
          status: 'ACTIVE',
          revokedAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it('should return null when session is revoked', async () => {
      mockUserSession.findFirst.mockResolvedValue(null);

      const result = await service.findActiveSessionByTokenHash('abc123hash');

      expect(result).toBeNull();
    });

    it('should return null when session is expired', async () => {
      mockUserSession.findFirst.mockResolvedValue(null);

      const result = await service.findActiveSessionByTokenHash('abc123hash');

      expect(result).toBeNull();
    });

    it('should return null when session is not found', async () => {
      mockUserSession.findFirst.mockResolvedValue(null);

      const result = await service.findActiveSessionByTokenHash('nonexistent');

      expect(result).toBeNull();
    });

    it('should return null when session is both expired and revoked', async () => {
      mockUserSession.findFirst.mockResolvedValue(null);

      const result = await service.findActiveSessionByTokenHash('abc123hash');

      expect(result).toBeNull();
    });
  });

  describe('revokeSession', () => {
    it('should update the session with revokedAt and revokedReason', async () => {
      const revokedSession = buildActiveSession({
        revokedAt: new Date(),
        revokedReason: 'LOGOUT',
      });
      mockUserSession.update.mockResolvedValue(revokedSession);

      const result = await service.revokeSession('session-uuid-1', 'LOGOUT');

      expect(result).toEqual(revokedSession);
    });

    it('should call prisma.userSession.update with the correct parameters', async () => {
      mockUserSession.update.mockResolvedValue(
        buildActiveSession({ revokedAt: new Date(), revokedReason: 'LOGOUT' }),
      );

      await service.revokeSession('session-uuid-1', 'LOGOUT');

      expect(mockUserSession.update).toHaveBeenCalledWith({
        where: { id: 'session-uuid-1' },
        data: {
          status: 'REVOKED',
          revokedAt: expect.any(Date),
          revokedReason: 'LOGOUT',
          revokedByUserId: null,
        },
      });
    });
  });

  describe('touchLastActivity', () => {
    it('should update lastActivityAt to current date', async () => {
      const updatedSession = buildActiveSession({
        lastActivityAt: new Date(),
      });
      mockUserSession.update.mockResolvedValue(updatedSession);

      const result = await service.touchLastActivity('session-uuid-1');

      expect(result).toEqual(updatedSession);
    });

    it('should call prisma.userSession.update with the session id', async () => {
      mockUserSession.update.mockResolvedValue(
        buildActiveSession({ lastActivityAt: new Date() }),
      );

      await service.touchLastActivity('session-uuid-1');

      expect(mockUserSession.update).toHaveBeenCalledWith({
        where: { id: 'session-uuid-1' },
        data: {
          lastActivityAt: expect.any(Date),
        },
      });
    });
  });
});
