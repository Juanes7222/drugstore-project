// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { SyncService } from './sync.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

const mockSyncQueue = {
  aggregate: jest.fn(),
  count: jest.fn(),
  findMany: jest.fn(),
  findUnique: jest.fn(),
  update: jest.fn(),
  create: jest.fn(),
};

const mockPrisma = {
  syncQueue: mockSyncQueue,
} as unknown as PrismaService;

describe('SyncService', () => {
  let service: SyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SyncService(mockPrisma);
  });

  // ── getMaxClientSequence ──────────────────────────────────────────────

  describe('getMaxClientSequence', () => {
    it('returns null when the workstation has no queued operations', async () => {
      mockSyncQueue.aggregate.mockResolvedValue({ _max: { clientSequence: null } });

      const result = await service.getMaxClientSequence('ws-empty');

      expect(result).toBeNull();
      expect(mockSyncQueue.aggregate).toHaveBeenCalledWith({
        _max: { clientSequence: true },
        where: { sourceWorkstationId: 'ws-empty' },
      });
    });

    it('returns the max clientSequence as a number when operations exist', async () => {
      mockSyncQueue.aggregate.mockResolvedValue({
        _max: { clientSequence: 42n },
      });

      const result = await service.getMaxClientSequence('ws-1');

      expect(result).toBe(42);
    });

    it('converts large BigInt values safely to Number', async () => {
      mockSyncQueue.aggregate.mockResolvedValue({
        _max: { clientSequence: 9007199254740991n },
      });

      const result = await service.getMaxClientSequence('ws-1');

      expect(result).toBe(9007199254740991);
    });
  });

  // ── getStatus ─────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns pending and failed counts for the workstation', async () => {
      mockSyncQueue.count.mockResolvedValueOnce(5).mockResolvedValueOnce(2);

      const result = await service.getStatus('ws-1');

      expect(result).toEqual({ sourceWorkstationId: 'ws-1', pending: 5, failed: 2 });
      expect(mockSyncQueue.count).toHaveBeenCalledTimes(2);
    });

    it('returns zero counts when no entries exist', async () => {
      mockSyncQueue.count.mockResolvedValue(0);

      const result = await service.getStatus('ws-empty');

      expect(result).toEqual({ sourceWorkstationId: 'ws-empty', pending: 0, failed: 0 });
    });
  });

  // ── findAll ───────────────────────────────────────────────────────────

  describe('findAll', () => {
    const mockEntries = [{ id: 'e1', operationType: 'SALE', status: 'PENDING' }];

    it('returns paginated results with total count', async () => {
      mockSyncQueue.findMany.mockResolvedValue(mockEntries);
      mockSyncQueue.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({ data: mockEntries, total: 1, page: 1, pageSize: 20 });
      expect(mockSyncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20, orderBy: { receivedAt: 'desc' } }),
      );
    });

    it('filters by status when provided', async () => {
      mockSyncQueue.findMany.mockResolvedValue([]);
      mockSyncQueue.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, status: 'FAILED' });

      expect(mockSyncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'FAILED' } }),
      );
    });

    it('filters by operationType when provided', async () => {
      mockSyncQueue.findMany.mockResolvedValue([]);
      mockSyncQueue.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, operationType: 'SALE' });

      expect(mockSyncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { operationType: 'SALE' } }),
      );
    });
  });

  // ── findOne ───────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the entry when found', async () => {
      const mockEntry = { id: 'e1', operationType: 'SALE' };
      mockSyncQueue.findUnique.mockResolvedValue(mockEntry);

      const result = await service.findOne('e1');

      expect(result).toEqual(mockEntry);
      expect(mockSyncQueue.findUnique).toHaveBeenCalledWith({ where: { id: 'e1' } });
    });

    it('returns null when not found', async () => {
      mockSyncQueue.findUnique.mockResolvedValue(null);

      const result = await service.findOne('nonexistent');

      expect(result).toBeNull();
    });
  });

  // ── retry ─────────────────────────────────────────────────────────────

  describe('retry', () => {
    it('resets a FAILED entry to PENDING', async () => {
      mockSyncQueue.findUnique.mockResolvedValue({ id: 'e1', status: 'FAILED' });
      mockSyncQueue.update.mockResolvedValue({ id: 'e1', status: 'PENDING' });

      const result = await service.retry('e1');

      expect(result).toEqual({ id: 'e1', status: 'PENDING' });
      expect(mockSyncQueue.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { status: 'PENDING', nextRetryAt: null, lastErrorMessage: null },
      });
    });

    it('returns null when entry does not exist', async () => {
      mockSyncQueue.findUnique.mockResolvedValue(null);

      const result = await service.retry('nonexistent');

      expect(result).toBeNull();
      expect(mockSyncQueue.update).not.toHaveBeenCalled();
    });
  });

  // ── receiveBatch ──────────────────────────────────────────────────────

  describe('receiveBatch', () => {
    it('accepts operations with valid hash', async () => {
      const batchDto = {
        operations: [
          {
            operationUuid: 'op-1',
            operationType: 'SALE',
            payload: { amount: 100 },
            payloadHash: '4d4bbe59c6aad22442cde199a6a8a5f034405fcd78fb5a81c24ef249de1c45f1',
            clientSequence: 1,
            sourceCreatedAt: '2024-01-01T00:00:00Z',
          },
        ],
      };

      mockSyncQueue.create.mockResolvedValue({ id: 'entry-1' });

      const results = await service.receiveBatch(batchDto, 'ws-1');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({ operationUuid: 'op-1', status: 'ACCEPTED' });
      expect(mockSyncQueue.create).toHaveBeenCalledTimes(1);
    });

    it('rejects operations with hash mismatch', async () => {
      const batchDto = {
        operations: [
          {
            operationUuid: 'op-bad',
            operationType: 'SALE',
            payload: { amount: 100 },
            payloadHash: 'invalid-hash',
            clientSequence: 1,
            sourceCreatedAt: '2024-01-01T00:00:00Z',
          },
        ],
      };

      const results = await service.receiveBatch(batchDto, 'ws-1');

      expect(results[0]).toEqual({
        operationUuid: 'op-bad',
        status: 'REJECTED',
        error: 'PAYLOAD_HASH_MISMATCH',
      });
      expect(mockSyncQueue.create).not.toHaveBeenCalled();
    });

    it('returns ALREADY_ACCEPTED for duplicate operationUuid', async () => {
      const batchDto = {
        operations: [
          {
            operationUuid: 'op-dup',
            operationType: 'SALE',
            payload: { amount: 100 },
            payloadHash: '4d4bbe59c6aad22442cde199a6a8a5f034405fcd78fb5a81c24ef249de1c45f1',
            clientSequence: 2,
            sourceCreatedAt: '2024-01-01T00:00:00Z',
          },
        ],
      };

      const prismaError = new Error('Unique constraint violation');
      (prismaError as any).code = 'P2002';
      mockSyncQueue.create.mockRejectedValue(prismaError);

      const results = await service.receiveBatch(batchDto, 'ws-1');

      expect(results[0]).toEqual({ operationUuid: 'op-dup', status: 'ALREADY_ACCEPTED' });
    });

    it('processes each operation independently (mixed results)', async () => {
      const batchDto = {
        operations: [
          {
            operationUuid: 'op-ok',
            operationType: 'SALE',
            payload: { amount: 100 },
            payloadHash: '4d4bbe59c6aad22442cde199a6a8a5f034405fcd78fb5a81c24ef249de1c45f1',
            clientSequence: 1,
            sourceCreatedAt: '2024-01-01T00:00:00Z',
          },
          {
            operationUuid: 'op-bad-hash',
            operationType: 'CLIENT',
            payload: { name: 'test' },
            payloadHash: 'wrong',
            clientSequence: 2,
            sourceCreatedAt: '2024-01-01T00:00:00Z',
          },
        ],
      };

      mockSyncQueue.create.mockResolvedValue({ id: 'entry-ok' });

      const results = await service.receiveBatch(batchDto, 'ws-1');

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ operationUuid: 'op-ok', status: 'ACCEPTED' });
      expect(results[1]).toEqual({ operationUuid: 'op-bad-hash', status: 'REJECTED', error: 'PAYLOAD_HASH_MISMATCH' });
    });

    it('rejects with error message when createQueueEntry throws non-P2002 error', async () => {
      const batchDto = {
        operations: [
          {
            operationUuid: 'op-db-error',
            operationType: 'SALE',
            payload: { amount: 100 },
            payloadHash: '4d4bbe59c6aad22442cde199a6a8a5f034405fcd78fb5a81c24ef249de1c45f1',
            clientSequence: 3,
            sourceCreatedAt: '2024-01-01T00:00:00Z',
          },
        ],
      };

      const dbError = new Error('Connection refused');
      mockSyncQueue.create.mockRejectedValue(dbError);

      const results = await service.receiveBatch(batchDto, 'ws-1');

      expect(results[0]).toEqual({
        operationUuid: 'op-db-error',
        status: 'REJECTED',
        error: 'Connection refused',
      });
    });
  });
});
