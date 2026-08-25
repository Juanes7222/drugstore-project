import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { Test, TestingModule } from '@nestjs/testing';
import { FiscalResolutionsController } from './fiscal-resolutions.controller';
import { FiscalResolutionsService } from '../services/fiscal-resolutions.service';
import { FiscalResolutionSyncService } from '../services/fiscal-resolution-sync.service';

const mockService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
};

const mockSyncService = {
  startSync: jest.fn(),
  getSyncStatus: jest.fn(),
};

describe('FiscalResolutionsController (integration)', () => {
  let controller: FiscalResolutionsController;
  let service: jest.Mocked<typeof mockService>;
  let syncService: jest.Mocked<typeof mockSyncService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FiscalResolutionsController],
      providers: [
        { provide: FiscalResolutionsService, useValue: mockService },
        { provide: FiscalResolutionSyncService, useValue: mockSyncService },
      ],
    }).compile();

    controller = module.get<FiscalResolutionsController>(
      FiscalResolutionsController,
    );
    service = module.get(FiscalResolutionsService) as jest.Mocked<
      typeof mockService
    >;
    syncService = module.get(FiscalResolutionSyncService) as jest.Mocked<
      typeof mockSyncService
    >;
  });

  describe('GET /fiscal-dian/resolutions', () => {
    it('should call findAll with query params', async () => {
      const query = { isActive: true, page: 1, pageSize: 10 };
      const expected = [{ id: 'r-1' }];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query as any);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(expected);
    });

    it('should call findAll with empty query', async () => {
      service.findAll.mockResolvedValue([]);

      const result = await controller.findAll({} as any);

      expect(service.findAll).toHaveBeenCalledWith({});
      expect(result).toEqual([]);
    });
  });

  describe('GET /fiscal-dian/resolutions/:id', () => {
    it('should call findById with the id', async () => {
      const expected = { id: 'r-1', resolutionNumber: 'RES-001' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById('r-1');

      expect(service.findById).toHaveBeenCalledWith('r-1');
      expect(result).toEqual(expected);
    });

    it('should propagate exception when not found', async () => {
      service.findById.mockRejectedValue(new Error('Resolution r-1 not found'));

      await expect(controller.findById('r-1')).rejects.toThrow('not found');
    });
  });

  describe('POST /fiscal-dian/resolutions', () => {
    it('should call create with DTO', async () => {
      const dto = {
        resolutionNumber: 'RES-001',
        documentType: 'INVOICE',
        prefix: 'SETP',
        rangeFrom: 1,
        rangeTo: 1000,
        validFrom: '2026-01-01',
        validTo: '2026-12-31',
        workstationId: null,
      };
      const expected = { id: 'r-1', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(expected);
    });

    it('should propagate validation errors', async () => {
      service.create.mockRejectedValue(new Error('Invalid resolution range'));

      await expect(controller.create({} as any)).rejects.toThrow(
        'Invalid resolution',
      );
    });
  });

  describe('POST /fiscal-dian/resolutions/sync-from-dian', () => {
    it('should delegate to syncService.startSync with the current user id', async () => {
      const expected = { syncJobId: 'job-1' };
      mockSyncService.startSync.mockResolvedValue(expected);
      const user = { id: 'user-1' } as any;

      const result = await controller.syncFromDian(
        { workstationId: 'ws-1' } as any,
        user,
      );

      expect(mockSyncService.startSync).toHaveBeenCalledWith(
        { workstationId: 'ws-1' },
        'user-1',
      );
      expect(result).toEqual(expected);
    });

    it('should pass null when the request carries no user', async () => {
      mockSyncService.startSync.mockResolvedValue({ syncJobId: 'job-2' });

      await controller.syncFromDian({} as any, undefined as any);

      expect(mockSyncService.startSync).toHaveBeenCalledWith({}, null);
    });
  });

  describe('GET /fiscal-dian/resolutions/sync-from-dian/:jobId', () => {
    it('should delegate to syncService.getSyncStatus with the job id', async () => {
      const expected = { status: 'APPLIED', created: [], skipped: [] };
      mockSyncService.getSyncStatus.mockResolvedValue(expected);

      const result = await controller.syncStatus('job-1');

      expect(mockSyncService.getSyncStatus).toHaveBeenCalledWith('job-1');
      expect(result).toEqual(expected);
    });

    it('should propagate typed failures (conflicts, not found)', async () => {
      mockSyncService.getSyncStatus.mockRejectedValue(
        new Error('DIAN_SYNC_JOB_NOT_FOUND'),
      );

      await expect(controller.syncStatus('missing')).rejects.toThrow(
        'DIAN_SYNC_JOB_NOT_FOUND',
      );
    });
  });
});
