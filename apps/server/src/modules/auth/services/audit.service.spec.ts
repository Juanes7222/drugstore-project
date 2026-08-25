import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { mockDeep, type MockProxy } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

jest.mock('@/infrastructure/prisma/prisma.service', () => ({
  PrismaService: class {},
}));
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { AuditService, AuditEvent } from './audit.service';

const CURSOR_TIMESTAMP = '2026-07-02T15:00:00.000Z';

function encodeCursorValue(lastUpdatedAt: string, lastId: string): string {
  return Buffer.from(JSON.stringify({ lastUpdatedAt, lastId })).toString('base64');
}

function decodeCursorValue(raw: string): { lastUpdatedAt: string; lastId: string } {
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

// Newest-first ledger rows (descending createdAt), as the audit walk reads them.
function buildAuditRows(count: number, newestAtIso: string): Array<Record<string, unknown>> {
  const newestMs = new Date(newestAtIso).getTime();
  return Array.from({ length: count }, (_, index) => ({
    id: `audit-log-${index + 1}`,
    action: 'LOGIN',
    createdAt: new Date(newestMs - index * 60_000),
  }));
}

describe('AuditEvent constants', () => {
  let prisma: MockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
  });

  it('exposes USER_APPROVED with the value used by the users controller', () => {
    const service = new AuditService(prisma as never);

    expect(AuditEvent.USER_APPROVED).toBe('USER_APPROVED');
    expect(service).toBeDefined();
  });

  it('exposes the other user-management event constants', () => {
    expect(AuditEvent.USER_CREATED).toBe('USER_CREATED');
    expect(AuditEvent.USER_UPDATED).toBe('USER_UPDATED');
    expect(AuditEvent.USER_DELETED).toBe('USER_DELETED');
    expect(AuditEvent.USER_DISABLED).toBe('USER_DISABLED');
    expect(AuditEvent.USER_ENABLED).toBe('USER_ENABLED');
  });
});

describe('AuditService.query', () => {
  let service: AuditService;
  let prisma: MockProxy<PrismaClient>;

  const findManyMock = (): jest.Mock =>
    (prisma.auditLog as any).findMany as unknown as jest.Mock;
  const countMock = (): jest.Mock =>
    (prisma.auditLog as any).count as unknown as jest.Mock;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new AuditService(prisma as never);
  });

  describe('cursor mode', () => {
    it('filters with the lt keyset condition and skips offset math when a cursor is given', async () => {
      findManyMock().mockResolvedValue(buildAuditRows(2, '2026-07-01T09:00:00Z'));

      await service.query({
        actorId: 'user-7',
        cursor: encodeCursorValue(CURSOR_TIMESTAMP, 'log-anchor'),
        limit: 2,
      });

      expect(findManyMock()).toHaveBeenCalledWith({
        where: {
          userId: 'user-7',
          OR: [
            { createdAt: { lt: new Date(CURSOR_TIMESTAMP) } },
            { createdAt: new Date(CURSOR_TIMESTAMP), id: { lt: 'log-anchor' } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 3,
      });
      const callArgs = findManyMock().mock.calls[0][0];
      expect(callArgs).not.toHaveProperty('skip');
      expect(countMock()).not.toHaveBeenCalled();
    });

    it('returns nextCursor and hasMore without a total when more rows exist than the page holds', async () => {
      const rows = buildAuditRows(3, '2026-07-01T09:00:00Z');
      findManyMock().mockResolvedValue(rows);

      const result = await service.query({
        cursor: encodeCursorValue(CURSOR_TIMESTAMP, 'log-anchor'),
        limit: 2,
      });

      expect(result.rows).toEqual(rows.slice(0, 2));
      expect(result.hasMore).toBe(true);
      expect(result.total).toBeUndefined();
      expect(decodeCursorValue(result.nextCursor as string)).toEqual({
        lastUpdatedAt: (rows[1]['createdAt'] as Date).toISOString(),
        lastId: 'audit-log-2',
      });
    });

    it('treats a garbage cursor string as the first page', async () => {
      findManyMock().mockResolvedValue(buildAuditRows(2, '2026-07-01T09:00:00Z'));

      const result = await service.query({
        actorId: 'user-7',
        cursor: '!!!not-a-real-cursor!!!',
        limit: 2,
      });

      // First-page semantics: base filters only, no OR keyset condition,
      // still take limit+1 so hasMore stays accurate.
      const callArgs = findManyMock().mock.calls[0][0];
      expect(callArgs.where).not.toHaveProperty('OR');
      expect(callArgs.where).toEqual({ userId: 'user-7' });
      expect(callArgs.take).toBe(3);
      expect(result.rows).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(result.nextCursor).toBeNull();
    });
  });

  describe('legacy offset mode', () => {
    it('returns rows with total and orders newest-first with an id tiebreak', async () => {
      const rows = buildAuditRows(1, '2026-07-01T09:00:00Z');
      findManyMock().mockResolvedValue(rows);
      countMock().mockResolvedValue(42);

      const result = await service.query({ limit: 25, offset: 50 });

      expect(result).toEqual({ rows, total: 42 });
      expect(findManyMock()).toHaveBeenCalledWith({
        where: {},
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 25,
        skip: 50,
      });
    });

    it('defaults to take 50 and skip 0 when limit and offset are omitted', async () => {
      findManyMock().mockResolvedValue([]);
      countMock().mockResolvedValue(0);

      await service.query({});

      expect(findManyMock()).toHaveBeenCalledWith(
        expect.objectContaining({ take: 50, skip: 0 }),
      );
    });
  });
});
