jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { SupplierReturnsController } from './supplier-returns.controller';
import { SupplierReturnsService } from '../services/supplier-returns.service';

const mockService = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  confirm: jest.fn(),
  approve: jest.fn(),
  annul: jest.fn(),
};

const mockUser = { id: 'user-1', role: 'INVENTORY_ASSISTANT' };

describe('SupplierReturnsController (integration)', () => {
  let controller: SupplierReturnsController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SupplierReturnsController],
      providers: [{ provide: SupplierReturnsService, useValue: mockService }],
    }).compile();

    controller = module.get<SupplierReturnsController>(SupplierReturnsController);
    service = module.get(SupplierReturnsService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /purchases/supplier-returns', () => {
    it('should call findAll with query', async () => {
      const query = { state: 'DRAFT' };
      const expected = { data: [{ id: 'sr-1' }], total: 1 };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query as any);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /purchases/supplier-returns/:id', () => {
    it('should call findOne with id', async () => {
      const expected = { id: 'sr-1', purchaseReceptionId: 'rec-1' };
      service.findOne.mockResolvedValue(expected);

      const result = await controller.findOne('sr-1');

      expect(service.findOne).toHaveBeenCalledWith('sr-1');
      expect(result).toEqual(expected);
    });

    it('should propagate not found', async () => {
      service.findOne.mockRejectedValue(new Error('not found'));

      await expect(controller.findOne('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('POST /purchases/supplier-returns', () => {
    it('should call create with DTO and userId', async () => {
      const dto = { purchaseReceptionId: 'rec-1', items: [{ lotId: 'lot-1', quantity: 5 }] };
      const expected = { id: 'sr-2', state: 'DRAFT' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any, mockUser as any);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /purchases/supplier-returns/:id/confirm', () => {
    it('should call confirm with id and userId', async () => {
      const expected = { id: 'sr-1', state: 'CONFIRMED' };
      service.confirm.mockResolvedValue(expected);

      const result = await controller.confirm('sr-1', mockUser as any);

      expect(service.confirm).toHaveBeenCalledWith('sr-1', mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /purchases/supplier-returns/:id/approve', () => {
    it('should call approve with id', async () => {
      const expected = { id: 'sr-1', state: 'APPROVED' };
      service.approve.mockResolvedValue(expected);

      const result = await controller.approve('sr-1');

      expect(service.approve).toHaveBeenCalledWith('sr-1');
      expect(result).toEqual(expected);
    });
  });

  describe('POST /purchases/supplier-returns/:id/annul', () => {
    it('should call annul with id', async () => {
      const expected = { id: 'sr-1', state: 'ANNULLED' };
      service.annul.mockResolvedValue(expected);

      const result = await controller.annul('sr-1');

      expect(service.annul).toHaveBeenCalledWith('sr-1');
      expect(result).toEqual(expected);
    });
  });
});
