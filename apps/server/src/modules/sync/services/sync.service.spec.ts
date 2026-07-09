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
});
