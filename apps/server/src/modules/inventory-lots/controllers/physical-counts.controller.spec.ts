jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { PhysicalCountsController } from './physical-counts.controller';
import { PhysicalCountsService } from '../services/physical-counts.service';

const mockService = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  start: jest.fn(),
  registerCount: jest.fn(),
  finish: jest.fn(),
  review: jest.fn(),
  approve: jest.fn(),
  apply: jest.fn(),
  annul: jest.fn(),
};

const mockUser = { id: 'user-1', role: 'INVENTORY_ASSISTANT' };

describe('PhysicalCountsController (integration)', () => {
  let controller: PhysicalCountsController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PhysicalCountsController],
      providers: [{ provide: PhysicalCountsService, useValue: mockService }],
    }).compile();

    controller = module.get<PhysicalCountsController>(PhysicalCountsController);
    service = module.get(PhysicalCountsService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /inventory-lots/physical-counts', () => {
    it('should call findAll with parsed pagination', async () => {
      const expected = { data: [{ id: 'pc-1' }], total: 1 };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll('1', '20', undefined);

      expect(service.findAll).toHaveBeenCalledWith({ page: 1, pageSize: 20, state: undefined });
      expect(result).toEqual(expected);
    });

    it('should call findAll with state filter', async () => {
      service.findAll.mockResolvedValue({ data: [], total: 0 });

      await controller.findAll(undefined, undefined, 'IN_PROGRESS');

      expect(service.findAll).toHaveBeenCalledWith({ page: undefined, pageSize: undefined, state: 'IN_PROGRESS' });
    });

    it('should handle undefined page params', async () => {
      service.findAll.mockResolvedValue({ data: [], total: 0 });

      await controller.findAll(undefined, undefined, undefined);

      expect(service.findAll).toHaveBeenCalledWith({ page: undefined, pageSize: undefined, state: undefined });
    });
  });

  describe('GET /inventory-lots/physical-counts/:id', () => {
    it('should call findOne with id', async () => {
      const expected = { id: 'pc-1', state: 'IN_PROGRESS' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('pc-1');

      expect(service.findOne).toHaveBeenCalledWith('pc-1');
      expect(result).toEqual(expected);
    });

    it('should propagate not found', async () => {
      service.findOne.mockRejectedValue(new Error('not found'));

      await expect(controller.findOne('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('POST /inventory-lots/physical-counts', () => {
    it('should call start with DTO and userId', async () => {
      const dto = { zone: 'A1' };
      const expected = { id: 'pc-2', state: 'IN_PROGRESS' };
      service.start.mockResolvedValue(expected);

      const result = await controller.start(dto as any, mockUser as any);

      expect(service.start).toHaveBeenCalledWith(dto, mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/physical-counts/:id/count-lines', () => {
    it('should call registerCount with id, DTO and userId', async () => {
      const dto = { lotId: 'lot-1', countedStock: 50 };
      const expected = { id: 'line-1', lotId: 'lot-1', countedStock: 50 };
      service.registerCount.mockResolvedValue(expected);

      const result = await controller.registerCount('pc-1', dto as any, mockUser as any);

      expect(service.registerCount).toHaveBeenCalledWith('pc-1', dto, mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/physical-counts/:id/finish', () => {
    it('should call finish with id', async () => {
      const expected = { id: 'pc-1', state: 'FINISHED' };
      service.finish.mockResolvedValue(expected);

      const result = await controller.finish('pc-1');

      expect(service.finish).toHaveBeenCalledWith('pc-1');
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/physical-counts/:id/review', () => {
    it('should call review with id', async () => {
      const expected = { id: 'pc-1', state: 'REVIEWED' };
      service.review.mockResolvedValue(expected);

      const result = await controller.review('pc-1');

      expect(service.review).toHaveBeenCalledWith('pc-1');
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/physical-counts/:id/approve', () => {
    it('should call approve with id and userId', async () => {
      const expected = { id: 'pc-1', state: 'APPROVED' };
      service.approve.mockResolvedValue(expected);

      const result = await controller.approve('pc-1', mockUser as any);

      expect(service.approve).toHaveBeenCalledWith('pc-1', mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/physical-counts/:id/apply', () => {
    it('should call apply with id and userId', async () => {
      const expected = { id: 'pc-1', state: 'APPLIED' };
      service.apply.mockResolvedValue(expected);

      const result = await controller.apply('pc-1', mockUser as any);

      expect(service.apply).toHaveBeenCalledWith('pc-1', mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/physical-counts/:id/annul', () => {
    it('should call annul with id and userId', async () => {
      const expected = { id: 'pc-1', state: 'ANNULLED' };
      service.annul.mockResolvedValue(expected);

      const result = await controller.annul('pc-1', mockUser as any);

      expect(service.annul).toHaveBeenCalledWith('pc-1', mockUser.id);
      expect(result).toEqual(expected);
    });
  });
});
