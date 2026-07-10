// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { SyncHealthService } from './sync-health.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

const mockSyncOperationOutcome = {
  groupBy: jest.fn(),
  count: jest.fn(),
};

const mockSyncQueue = {
  findFirst: jest.fn(),
  count: jest.fn(),
};

const mockPrisma = {
  syncOperationOutcome: mockSyncOperationOutcome,
  syncQueue: mockSyncQueue,
} as unknown as PrismaService;

describe('SyncHealthService', () => {
  let service: SyncHealthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SyncHealthService(mockPrisma);
  });

  // ── getHealth ─────────────────────────────────────────────────────────

  describe('getHealth', () => {
    it('aggregates health from perWorkstation, totals, and topFailureCategories', async () => {
      // Arrange: perWorkstation groupBy returns mixed outcomes for two workstations
      mockSyncOperationOutcome.groupBy
        .mockResolvedValueOnce([
          { workstationId: 'ws-1', outcome: 'ACCEPTED', _count: 5 },
          { workstationId: 'ws-1', outcome: 'REJECTED', _count: 2 },
          { workstationId: 'ws-2', outcome: 'FAILED', _count: 1 },
        ]);

      // Arrange: oldest pending queries for ws-1 and ws-2
      mockSyncQueue.findFirst
        .mockResolvedValueOnce({ receivedAt: new Date(Date.now() - 600_000) }) // 10 min ago
        .mockResolvedValueOnce(null); // ws-2 has no pending

      // Arrange: totals
      mockSyncOperationOutcome.count
        .mockResolvedValueOnce(5)  // completed
        .mockResolvedValueOnce(2)  // rejected
        .mockResolvedValueOnce(1)  // permanentFailure
      mockSyncQueue.count
        .mockResolvedValueOnce(3); // pending

      // Arrange: top failure categories
      mockSyncOperationOutcome.groupBy
        .mockResolvedValueOnce([
          { failureCategory: 'VALIDATION', _count: 3 },
          { failureCategory: 'CONFLICT', _count: 1 },
        ]);

      const result = await service.getHealth(24);

      expect(result.windowHours).toBe(24);

      // perWorkstation — sorted by workstationId
      expect(result.perWorkstation).toHaveLength(2);
      expect(result.perWorkstation[0]).toEqual({
        workstationId: 'ws-1',
        completed: 5,
        rejected: 2,
        permanentFailure: 0,
        oldestPendingAgeSeconds: expect.any(Number),
      });
      expect(result.perWorkstation[1]).toEqual({
        workstationId: 'ws-2',
        completed: 0,
        rejected: 0,
        permanentFailure: 1,
        oldestPendingAgeSeconds: null,
      });

      // totals
      expect(result.totals).toEqual({
        completed: 5,
        rejected: 2,
        permanentFailure: 1,
        pending: 3,
      });

      // topFailureCategories
      expect(result.topFailureCategories).toHaveLength(2);
      expect(result.topFailureCategories[0]).toEqual({ category: 'VALIDATION', count: 3 });
      expect(result.topFailureCategories[1]).toEqual({ category: 'CONFLICT', count: 1 });
    });

    it('returns empty aggregates when there is no activity in the window', async () => {
      mockSyncOperationOutcome.groupBy
        .mockResolvedValueOnce([]);

      // No workstation IDs → no oldest-pending queries
      mockSyncOperationOutcome.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      mockSyncQueue.count.mockResolvedValueOnce(0);

      mockSyncOperationOutcome.groupBy
        .mockResolvedValueOnce([]);

      const result = await service.getHealth(24);

      expect(result.perWorkstation).toEqual([]);
      expect(result.totals).toEqual({
        completed: 0,
        rejected: 0,
        permanentFailure: 0,
        pending: 0,
      });
      expect(result.topFailureCategories).toEqual([]);
    });

    it('supports a custom window parameter', async () => {
      mockSyncOperationOutcome.groupBy
        .mockResolvedValueOnce([]);
      mockSyncOperationOutcome.count
        .mockResolvedValue(0);
      mockSyncQueue.count.mockResolvedValue(0);
      mockSyncOperationOutcome.groupBy
        .mockResolvedValueOnce([]);

      const result = await service.getHealth(6);

      expect(result.windowHours).toBe(6);
    });

    it('treats ALREADY_ACCEPTED as completed in per-workstation counts', async () => {
      mockSyncOperationOutcome.groupBy
        .mockResolvedValueOnce([
          { workstationId: 'ws-1', outcome: 'ALREADY_ACCEPTED', _count: 3 },
        ]);
      mockSyncOperationOutcome.count
        .mockResolvedValue(0);
      mockSyncQueue.count.mockResolvedValue(0);
      mockSyncOperationOutcome.groupBy
        .mockResolvedValueOnce([]);

      const result = await service.getHealth(1);

      expect(result.perWorkstation[0].completed).toBe(3);
      expect(result.perWorkstation[0].rejected).toBe(0);
    });
  });
});
