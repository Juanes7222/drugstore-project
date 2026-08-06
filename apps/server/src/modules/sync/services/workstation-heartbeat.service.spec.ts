import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import type { PrismaClient } from '@pharmacy/database';

// The Prisma 7 client is generated at build time; keep the real package out
// of the module graph so the spec can run without the generated client.
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import {
  WorkstationHeartbeatService,
  HeartbeatInput,
} from './workstation-heartbeat.service';

function buildHeartbeat(index: number, overrides: Partial<HeartbeatInput> = {}) {
  return {
    workstationId: `ws-${index}`,
    queueDepth: 3,
    permanentFailures: 0,
    reportedBy: 'hub-1',
    ...overrides,
  };
}

describe('WorkstationHeartbeatService', () => {
  let service: WorkstationHeartbeatService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new WorkstationHeartbeatService(prisma as any);
  });

  // -------------------------------------------------------------------------
  // recordHeartbeats
  // -------------------------------------------------------------------------
  describe('recordHeartbeats', () => {
    it('creates heartbeats in chunks of 200 and sums the recorded count', async () => {
      // FIX-012: batches are bounded to 200 rows per createMany instead of
      // one unbounded call per hub batch.
      const heartbeats = Array.from({ length: 250 }, (_, i) => buildHeartbeat(i));
      prisma.workstationHeartbeat.createMany
        .mockResolvedValueOnce({ count: 200 })
        .mockResolvedValueOnce({ count: 50 });

      const result = await service.recordHeartbeats(heartbeats);

      expect(result).toEqual({ recorded: 250 });
      const firstCallData = (prisma.workstationHeartbeat.createMany as jest.Mock).mock.calls[0][0].data;
      const secondCallData = (prisma.workstationHeartbeat.createMany as jest.Mock).mock.calls[1][0].data;
      expect(firstCallData).toHaveLength(200);
      expect(secondCallData).toHaveLength(50);
    });

    it('binds one receivedAt timestamp to every row of the batch', async () => {
      prisma.workstationHeartbeat.createMany.mockResolvedValue({ count: 2 });

      await service.recordHeartbeats([buildHeartbeat(1), buildHeartbeat(2)]);

      const data = (prisma.workstationHeartbeat.createMany as jest.Mock).mock.calls[0][0].data;
      expect(data).toHaveLength(2);
      expect(data[0].receivedAt).toBeInstanceOf(Date);
      expect(data[1].receivedAt).toEqual(data[0].receivedAt);
    });

    it('maps optional fields to null when absent', async () => {
      prisma.workstationHeartbeat.createMany.mockResolvedValue({ count: 1 });

      await service.recordHeartbeats([buildHeartbeat(1)]);

      const data = (prisma.workstationHeartbeat.createMany as jest.Mock).mock.calls[0][0].data;
      expect(data[0]).toMatchObject({
        workstationId: 'ws-1',
        friendlyName: null,
        appVersion: null,
        oldestPendingAt: null,
        diskSpaceMb: null,
        lastLanSyncAt: null,
        reportedBy: 'hub-1',
      });
    });

    it('parses ISO date strings into Date objects', async () => {
      prisma.workstationHeartbeat.createMany.mockResolvedValue({ count: 1 });

      await service.recordHeartbeats([
        buildHeartbeat(1, {
          oldestPendingAt: '2026-08-05T10:00:00.000Z',
          lastLanSyncAt: '2026-08-05T09:30:00.000Z',
        }),
      ]);

      const data = (prisma.workstationHeartbeat.createMany as jest.Mock).mock.calls[0][0].data;
      expect(data[0].oldestPendingAt).toEqual(new Date('2026-08-05T10:00:00.000Z'));
      expect(data[0].lastLanSyncAt).toEqual(new Date('2026-08-05T09:30:00.000Z'));
    });

    it('falls back to per-row create when a chunk fails, recording only successful rows', async () => {
      prisma.workstationHeartbeat.createMany.mockRejectedValueOnce(new Error('chunk failed'));
      prisma.workstationHeartbeat.create
        .mockResolvedValueOnce({ id: 'row-1' })
        .mockRejectedValueOnce(new Error('duplicate key'));

      const result = await service.recordHeartbeats([
        buildHeartbeat(1),
        buildHeartbeat(2),
      ]);

      expect(result).toEqual({ recorded: 1 });
      expect(prisma.workstationHeartbeat.create).toHaveBeenCalledTimes(2);
    });
  });

  // -------------------------------------------------------------------------
  // getWorkstationStatuses
  // -------------------------------------------------------------------------
  describe('getWorkstationStatuses', () => {
    it('marks heartbeats older than 5 minutes as stale', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          workstationId: 'ws-1',
          friendlyName: 'Caja 1',
          appVersion: '1.2.0',
          queueDepth: 0,
          permanentFailures: 0,
          diskSpaceMb: 1024,
          lastLanSyncAt: null,
          receivedAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ]);

      const result = await service.getWorkstationStatuses();

      expect(result[0].isStale).toBe(true);
      expect(result[0].lastHeartbeatAt).toBeInstanceOf(Date);
    });

    it('marks recent heartbeats as fresh', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          workstationId: 'ws-1',
          friendlyName: null,
          appVersion: null,
          queueDepth: 5,
          permanentFailures: 1,
          diskSpaceMb: null,
          lastLanSyncAt: null,
          receivedAt: new Date(),
        },
      ]);

      const result = await service.getWorkstationStatuses();

      expect(result[0].isStale).toBe(false);
      expect(result[0].workstationId).toBe('ws-1');
    });
  });

  // -------------------------------------------------------------------------
  // countStale
  // -------------------------------------------------------------------------
  describe('countStale', () => {
    it('counts only stale workstations', async () => {
      (prisma.$queryRaw as jest.Mock).mockResolvedValue([
        {
          workstationId: 'ws-1',
          friendlyName: null,
          appVersion: null,
          queueDepth: 0,
          permanentFailures: 0,
          diskSpaceMb: null,
          lastLanSyncAt: null,
          receivedAt: new Date(Date.now() - 10 * 60 * 1000),
        },
        {
          workstationId: 'ws-2',
          friendlyName: null,
          appVersion: null,
          queueDepth: 0,
          permanentFailures: 0,
          diskSpaceMb: null,
          lastLanSyncAt: null,
          receivedAt: new Date(),
        },
      ]);

      const result = await service.countStale();

      expect(result).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // deleteOld
  // -------------------------------------------------------------------------
  describe('deleteOld', () => {
    it('deletes heartbeats older than the retention window and returns the count', async () => {
      prisma.workstationHeartbeat.deleteMany.mockResolvedValue({ count: 7 });

      const result = await service.deleteOld(72);

      expect(result).toBe(7);
      expect(prisma.workstationHeartbeat.deleteMany).toHaveBeenCalledWith({
        where: { receivedAt: { lt: expect.any(Date) } },
      });
    });
  });
});
