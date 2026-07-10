// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from '../services/sync.service';
import { SyncHealthService } from '../services/sync-health.service';
import { InvoiceTransmissionResultService } from '../services/invoice-transmission-result.service';
import { LocalNumberHintQuerySchema } from '../dto/local-number-hint-query.dto';

const mockSyncService = {
  receiveBatch: jest.fn(),
  getStatus: jest.fn(),
  findAll: jest.fn(),
  findOne: jest.fn(),
  retry: jest.fn(),
  getMaxClientSequence: jest.fn(),
};

const mockSyncHealthService = {
  getHealth: jest.fn(),
};

const mockInvoiceTransmissionResultService = {
  saveResult: jest.fn(),
  findResultsForWorkstation: jest.fn(),
};

describe('SyncController', () => {
  let controller: SyncController;
  let service: jest.Mocked<typeof mockSyncService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SyncController],
      providers: [
        { provide: SyncService, useValue: mockSyncService },
        { provide: SyncHealthService, useValue: mockSyncHealthService },
        { provide: InvoiceTransmissionResultService, useValue: mockInvoiceTransmissionResultService },
      ],
    }).compile();

    controller = module.get<SyncController>(SyncController);
    service = module.get(SyncService) as jest.Mocked<typeof mockSyncService>;
  });

  describe('GET /sync/local-number-hint', () => {
    it('returns the max local number for a workstation', async () => {
      service.getMaxClientSequence.mockResolvedValue(128);

      const result = await controller.getLocalNumberHint({
        workstationId: 'ws-1',
      });

      expect(result).toEqual({
        workstationId: 'ws-1',
        maxLocalNumber: 128,
      });
      expect(service.getMaxClientSequence).toHaveBeenCalledWith('ws-1');
    });

    it('returns null when the workstation has no queued operations', async () => {
      service.getMaxClientSequence.mockResolvedValue(null);

      const result = await controller.getLocalNumberHint({
        workstationId: 'ws-empty',
      });

      expect(result).toEqual({
        workstationId: 'ws-empty',
        maxLocalNumber: null,
      });
    });

    it('rejects an empty workstation id via the query schema', () => {
      const result = LocalNumberHintQuerySchema.safeParse({ workstationId: '' });

      expect(result.success).toBe(false);
      expect(service.getMaxClientSequence).not.toHaveBeenCalled();
    });
  });
});
