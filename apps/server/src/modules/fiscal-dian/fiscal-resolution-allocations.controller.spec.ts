jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { FiscalResolutionAllocationsController } from './fiscal-resolution-allocations.controller';
import { FiscalResolutionAllocationsService } from './fiscal-resolution-allocations.service';

const mockService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
};

describe('FiscalResolutionAllocationsController (integration)', () => {
  let controller: FiscalResolutionAllocationsController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FiscalResolutionAllocationsController],
      providers: [{ provide: FiscalResolutionAllocationsService, useValue: mockService }],
    }).compile();

    controller = module.get<FiscalResolutionAllocationsController>(FiscalResolutionAllocationsController);
    service = module.get(FiscalResolutionAllocationsService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /fiscal-dian/resolution-allocations', () => {
    it('should call findAll with default pagination', async () => {
      const expected = [{ id: 'a-1' }];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalledWith(1, 20);
      expect(result).toEqual(expected);
    });

    it('should pass page and pageSize as numbers', async () => {
      service.findAll.mockResolvedValue([]);

      await controller.findAll('2' as any, '10' as any);

      expect(service.findAll).toHaveBeenCalledWith(2, 10);
    });
  });

  describe('GET /fiscal-dian/resolution-allocations/:id', () => {
    it('should call findById with the id', async () => {
      const expected = { id: 'a-1', resolutionId: 'r-1' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById('a-1');

      expect(service.findById).toHaveBeenCalledWith('a-1');
      expect(result).toEqual(expected);
    });

    it('should propagate exception when not found', async () => {
      service.findById.mockRejectedValue(new Error('not found'));

      await expect(controller.findById('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('POST /fiscal-dian/resolution-allocations', () => {
    it('should call create with DTO and userId', async () => {
      const dto = { resolutionId: 'r-1', fromNumber: 1, toNumber: 100 };
      const user = { id: 'user-1' };
      const expected = { id: 'a-1', ...dto };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any, user as any);

      expect(service.create).toHaveBeenCalledWith(dto, user.id);
      expect(result).toEqual(expected);
    });
  });
});
