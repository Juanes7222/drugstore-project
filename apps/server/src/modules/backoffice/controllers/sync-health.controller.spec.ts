jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { SyncHealthController } from './sync-health.controller';
import { SyncHealthService } from '@/modules/sync/services/sync-health.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';

const mockSyncHealthService = {
  getHealth: jest.fn(),
};

const mockPrisma = {
  syncQueue: {
    findMany: jest.fn(),
    count: jest.fn(),
  },
};

describe('SyncHealthController (integration)', () => {
  let controller: SyncHealthController;
  let syncHealthService: jest.Mocked<typeof mockSyncHealthService>;
  let prisma: jest.Mocked<typeof mockPrisma>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncHealthController],
      providers: [
        { provide: SyncHealthService, useValue: mockSyncHealthService },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    controller = module.get<SyncHealthController>(SyncHealthController);
    syncHealthService = module.get(SyncHealthService) as jest.Mocked<typeof mockSyncHealthService>;
    prisma = module.get(PrismaService) as jest.Mocked<typeof mockPrisma>;
  });

  describe('GET /backoffice/sync-health', () => {
    it('should call getHealth with default 24h window', async () => {
      const expected = { workstations: [], totals: { pending: 0, processed: 0, failed: 0 } };
      syncHealthService.getHealth.mockResolvedValue(expected);

      const result = await controller.getHealth({} as any);

      expect(syncHealthService.getHealth).toHaveBeenCalledWith(24);
      expect(result).toEqual(expected);
    });

    it('should pass custom windowHours clamped between 1-168', async () => {
      syncHealthService.getHealth.mockResolvedValue({} as any);

      await controller.getHealth({ windowHours: '48' } as any);

      expect(syncHealthService.getHealth).toHaveBeenCalledWith(48);
    });

    it('should clamp windowHours to min 1', async () => {
      syncHealthService.getHealth.mockResolvedValue({} as any);

      await controller.getHealth({ windowHours: '0' } as any);

      expect(syncHealthService.getHealth).toHaveBeenCalledWith(1);
    });

    it('should clamp windowHours to max 168', async () => {
      syncHealthService.getHealth.mockResolvedValue({} as any);

      await controller.getHealth({ windowHours: '200' } as any);

      expect(syncHealthService.getHealth).toHaveBeenCalledWith(168);
    });
  });

  describe('GET /backoffice/permanent-failures', () => {
    const sampleRows = [
      { id: 'f-1', operationType: 'SALE' as const, status: 'PERMANENT_FAILURE' as const },
    ];

    it('should query syncQueue with default pagination', async () => {
      prisma.syncQueue.findMany.mockResolvedValue(sampleRows);
      prisma.syncQueue.count.mockResolvedValue(1);

      const result = await controller.getPermanentFailures({} as any);

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: 'PERMANENT_FAILURE' },
          skip: 0,
          take: 20,
        }),
      );
      expect(prisma.syncQueue.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'PERMANENT_FAILURE' } }),
      );
      expect(result).toEqual({
        data: sampleRows,
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    });

    it('should pass custom pagination params', async () => {
      prisma.syncQueue.findMany.mockResolvedValue([]);
      prisma.syncQueue.count.mockResolvedValue(0);

      await controller.getPermanentFailures({ page: '2', pageSize: '10' } as any);

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 10, take: 10 }),
      );
    });

    it('should filter by workstationId when provided', async () => {
      prisma.syncQueue.findMany.mockResolvedValue([]);
      prisma.syncQueue.count.mockResolvedValue(0);

      await controller.getPermanentFailures({ workstationId: 'ws-1' } as any);

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ sourceWorkstationId: 'ws-1' }),
        }),
      );
    });

    it('should filter by date range when provided', async () => {
      prisma.syncQueue.findMany.mockResolvedValue([]);
      prisma.syncQueue.count.mockResolvedValue(0);

      await controller.getPermanentFailures({ since: '2026-01-01', until: '2026-01-31' } as any);

      const callArgs = (prisma.syncQueue.findMany as jest.Mock).mock.calls[0][0];
      expect(callArgs.where.receivedAt).toBeDefined();
      expect(callArgs.where.receivedAt.gte).toEqual(new Date('2026-01-01'));
      expect(callArgs.where.receivedAt.lte).toEqual(new Date('2026-01-31'));
    });

    it('should clamp page to min 1', async () => {
      prisma.syncQueue.findMany.mockResolvedValue([]);
      prisma.syncQueue.count.mockResolvedValue(0);

      await controller.getPermanentFailures({ page: '-1' } as any);

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0 }),
      );
    });

    it('should clamp pageSize between 1 and 100', async () => {
      prisma.syncQueue.findMany.mockResolvedValue([]);
      prisma.syncQueue.count.mockResolvedValue(0);

      await controller.getPermanentFailures({ pageSize: '200' } as any);

      expect(prisma.syncQueue.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });
  });
});
