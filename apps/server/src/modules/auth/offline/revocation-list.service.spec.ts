// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {}
  return { PrismaClient: MockPrismaClient };
});

import { ConfigService } from '@nestjs/config';
import { mockDeep, MockProxy } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { RevocationListService } from './revocation-list.service';
import { AuditService } from '../services/audit.service';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPrisma = mockDeep<PrismaClient>() as MockProxy<PrismaClient>;
const mockAuditService = { log: jest.fn() } as any;
const mockOfflineTokenRevocation = {
  findUnique: jest.fn(),
  findFirst: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
  deleteMany: jest.fn(),
};

(mockPrisma as any).offlineTokenRevocation = mockOfflineTokenRevocation;

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildDbEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'entry-uuid-1',
    jti: 'jti-uuid-1',
    userId: 'user-uuid-1',
    workstationId: null,
    reason: 'ADMIN_REVOCATION',
    reasonDetail: null,
    revokedAt: new Date('2026-06-15T10:00:00Z'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RevocationListService', () => {
  let service: RevocationListService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RevocationListService(
      mockPrisma as unknown as PrismaService,
      mockAuditService,
    );
  });

  // -----------------------------------------------------------------------
  // getDeltaSince
  // -----------------------------------------------------------------------
  describe('getDeltaSince', () => {
    it('returns only entries after the timestamp', async () => {
      const entries = [
        buildDbEntry({ jti: 'jti-1', revokedAt: new Date('2026-06-20T00:00:00Z') }),
        buildDbEntry({ jti: 'jti-2', revokedAt: new Date('2026-06-21T00:00:00Z') }),
      ];
      mockOfflineTokenRevocation.findMany.mockResolvedValue(entries);

      const result = await service.getDeltaSince(new Date('2026-06-10T00:00:00Z'));

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ jti: 'jti-1', reason: 'ADMIN_REVOCATION' });
    });

    it('queries with correct where clause and ordering', async () => {
      const since = new Date('2026-06-10T00:00:00Z');
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);

      await service.getDeltaSince(since);

      expect(mockOfflineTokenRevocation.findMany).toHaveBeenCalledWith({
        where: { revokedAt: { gt: since } },
        orderBy: { revokedAt: 'asc' },
      });
    });

    it('returns empty array when no entries exist', async () => {
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);

      const result = await service.getDeltaSince(new Date());

      expect(result).toEqual([]);
    });

    it('maps only jti, revokedAt, reason fields', async () => {
      const entry = buildDbEntry({
        id: 'some-id',
        jti: 'jti-uuid',
        revokedAt: new Date('2026-07-01T00:00:00Z'),
        reason: 'PASSWORD_CHANGED',
        userId: 'internal-user-id',
        workstationId: 'ws-1',
        reasonDetail: 'some detail',
      });
      mockOfflineTokenRevocation.findMany.mockResolvedValue([entry]);

      const result = await service.getDeltaSince(new Date('2026-01-01T00:00:00Z'));

      expect(result[0]).toEqual({
        jti: 'jti-uuid',
        revokedAt: new Date('2026-07-01T00:00:00Z'),
        reason: 'PASSWORD_CHANGED',
      });
      expect(result[0]).not.toHaveProperty('id');
      expect(result[0]).not.toHaveProperty('userId');
    });
  });

  // -----------------------------------------------------------------------
  // getList
  // -----------------------------------------------------------------------
  describe('getList', () => {
    it('returns paginated results without since filter', async () => {
      const entries = [
        buildDbEntry({ jti: 'jti-1', revokedAt: new Date('2026-06-20T00:00:00Z') }),
        buildDbEntry({ jti: 'jti-2', revokedAt: new Date('2026-06-19T00:00:00Z') }),
      ];
      mockOfflineTokenRevocation.findMany.mockResolvedValue(entries);
      mockOfflineTokenRevocation.count.mockResolvedValue(10);

      const result = await service.getList({ limit: 5, offset: 0 });

      expect(result.total).toBe(10);
      expect(result.entries).toHaveLength(2);
      expect(mockOfflineTokenRevocation.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { revokedAt: 'desc' },
        take: 5,
        skip: 0,
      });
    });

    it('filters by since when provided', async () => {
      const since = new Date('2026-06-01T00:00:00Z');
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);
      mockOfflineTokenRevocation.count.mockResolvedValue(0);

      await service.getList({ since });

      expect(mockOfflineTokenRevocation.findMany).toHaveBeenCalledWith({
        where: { revokedAt: { gt: since } },
        orderBy: { revokedAt: 'desc' },
        take: 100,
        skip: 0,
      });
      expect(mockOfflineTokenRevocation.count).toHaveBeenCalledWith({
        where: { revokedAt: { gt: since } },
      });
    });

    it('logs audit event for every list fetch', async () => {
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);
      mockOfflineTokenRevocation.count.mockResolvedValue(0);

      await service.getList({ limit: 10 });

      expect(mockAuditService.log).toHaveBeenCalledWith(
        expect.stringContaining('REVOCATION_LIST_UPDATED'),
        expect.objectContaining({
          details: expect.objectContaining({
            entriesReturned: 0,
            total: 0,
          }),
        }),
      );
    });

    it('applies default pagination when not provided', async () => {
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);
      mockOfflineTokenRevocation.count.mockResolvedValue(0);

      await service.getList({});

      expect(mockOfflineTokenRevocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100, skip: 0 }),
      );
    });
  });

  // -----------------------------------------------------------------------
  // isRevoked
  // -----------------------------------------------------------------------
  describe('isRevoked', () => {
    it('returns true when JTI exists in revocation list', async () => {
      mockOfflineTokenRevocation.findUnique.mockResolvedValue(buildDbEntry());

      const result = await service.isRevoked('jti-uuid-1');

      expect(result).toBe(true);
    });

    it('returns false when JTI is not found', async () => {
      mockOfflineTokenRevocation.findUnique.mockResolvedValue(null);

      const result = await service.isRevoked('non-existent-jti');

      expect(result).toBe(false);
    });

    it('queries by jti', async () => {
      mockOfflineTokenRevocation.findUnique.mockResolvedValue(null);

      await service.isRevoked('some-jti');

      expect(mockOfflineTokenRevocation.findUnique).toHaveBeenCalledWith({
        where: { jti: 'some-jti' },
      });
    });
  });

  // -----------------------------------------------------------------------
  // getUrgentRevocationsSince
  // -----------------------------------------------------------------------
  describe('getUrgentRevocationsSince', () => {
    it('returns recent entries', async () => {
      const entries = [
        buildDbEntry({ jti: 'jti-urgent', revokedAt: new Date() }),
      ];
      mockOfflineTokenRevocation.findMany.mockResolvedValue(entries);

      const result = await service.getUrgentRevocationsSince(
        new Date(Date.now() - 3600000), // 1 hour ago
      );

      expect(result).toHaveLength(1);
      expect(result[0].jti).toBe('jti-urgent');
    });

    it('uses 24h cutoff when since is older than 24h', async () => {
      const tooOld = new Date('2020-01-01T00:00:00Z');
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);

      await service.getUrgentRevocationsSince(tooOld);

      // Should have used a cutoff of now - 24h, not the old since date
      const callArgs = mockOfflineTokenRevocation.findMany.mock.calls[0][0];
      const cutoff = callArgs.where.revokedAt.gt;
      const cutoffTime = cutoff.getTime();
      const now = Date.now();

      expect(cutoffTime).toBeGreaterThan(tooOld.getTime());
      expect(cutoffTime).toBeGreaterThan(now - 86400000 - 1000); // Within ~1 sec of 24h ago
      expect(cutoffTime).toBeLessThanOrEqual(now - 86400000 + 1000);
    });

    it('uses the since parameter directly when it is within 24h', async () => {
      const recent = new Date(Date.now() - 3600000); // 1 hour ago
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);

      await service.getUrgentRevocationsSince(recent);

      const callArgs = mockOfflineTokenRevocation.findMany.mock.calls[0][0];
      expect(callArgs.where.revokedAt.gt.getTime()).toBe(recent.getTime());
    });

    it('limits results to 200 entries', async () => {
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);

      await service.getUrgentRevocationsSince(new Date());

      expect(mockOfflineTokenRevocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 200 }),
      );
    });

    it('orders results by revokedAt descending', async () => {
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);

      await service.getUrgentRevocationsSince(new Date());

      expect(mockOfflineTokenRevocation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { revokedAt: 'desc' } }),
      );
    });

    it('returns empty array when no urgent revocations', async () => {
      mockOfflineTokenRevocation.findMany.mockResolvedValue([]);

      const result = await service.getUrgentRevocationsSince(new Date());

      expect(result).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // cleanOldEntries
  // -----------------------------------------------------------------------
  describe('cleanOldEntries', () => {
    it('removes entries older than the retention period', async () => {
      mockOfflineTokenRevocation.deleteMany.mockResolvedValue({ count: 5 });

      const result = await service.cleanOldEntries(90);

      expect(result).toBe(5);
      expect(mockOfflineTokenRevocation.deleteMany).toHaveBeenCalled();

      const callArgs = mockOfflineTokenRevocation.deleteMany.mock.calls[0][0];
      const cutoff = callArgs.where.revokedAt.lt;
      const cutoffTime = cutoff.getTime();
      const now = Date.now();

      expect(cutoffTime).toBeGreaterThan(now - 90 * 86400000 - 5000);
      expect(cutoffTime).toBeLessThanOrEqual(now - 90 * 86400000 + 5000);
    });

    it('uses default retention of 90 days when not specified', async () => {
      mockOfflineTokenRevocation.deleteMany.mockResolvedValue({ count: 0 });

      await service.cleanOldEntries();

      const callArgs = mockOfflineTokenRevocation.deleteMany.mock.calls[0][0];
      const cutoff = callArgs.where.revokedAt.lt;
      const cutoffTime = cutoff.getTime();
      const now = Date.now();

      expect(cutoffTime).toBeGreaterThan(now - 90 * 86400000 - 5000);
      expect(cutoffTime).toBeLessThanOrEqual(now - 90 * 86400000 + 5000);
    });

    it('uses custom retention days when specified', async () => {
      mockOfflineTokenRevocation.deleteMany.mockResolvedValue({ count: 3 });

      await service.cleanOldEntries(30);

      const callArgs = mockOfflineTokenRevocation.deleteMany.mock.calls[0][0];
      const cutoff = callArgs.where.revokedAt.lt;
      const cutoffTime = cutoff.getTime();
      const now = Date.now();

      expect(cutoffTime).toBeGreaterThan(now - 30 * 86400000 - 5000);
      expect(cutoffTime).toBeLessThanOrEqual(now - 30 * 86400000 + 5000);
    });

    it('returns 0 when no entries match', async () => {
      mockOfflineTokenRevocation.deleteMany.mockResolvedValue({ count: 0 });

      const result = await service.cleanOldEntries();

      expect(result).toBe(0);
    });
  });
});
