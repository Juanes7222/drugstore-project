jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { PurchaseOrdersService } from '../services/purchase-orders.service';

const mockService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  confirm: jest.fn(),
  annul: jest.fn(),
};

const mockUser = { id: 'user-1', role: 'INVENTORY_ASSISTANT' };

describe('PurchaseOrdersController (integration)', () => {
  let controller: PurchaseOrdersController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseOrdersController],
      providers: [{ provide: PurchaseOrdersService, useValue: mockService }],
    }).compile();

    controller = module.get<PurchaseOrdersController>(PurchaseOrdersController);
    service = module.get(PurchaseOrdersService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /purchases/purchase-orders', () => {
    it('should call findAll with query', async () => {
      const query = { supplierId: 's-1', state: 'CONFIRMED' };
      const expected = { data: [{ id: 'po-1' }], total: 1 };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query as any);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /purchases/purchase-orders/:id', () => {
    it('should call findById with id', async () => {
      const expected = { id: 'po-1', supplierId: 's-1' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById('po-1');

      expect(service.findById).toHaveBeenCalledWith('po-1');
      expect(result).toEqual(expected);
    });

    it('should propagate not found', async () => {
      service.findById.mockRejectedValue(new Error('not found'));

      await expect(controller.findById('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('POST /purchases/purchase-orders', () => {
    it('should call create with DTO and userId', async () => {
      const dto = { supplierId: 's-1', items: [{ productId: 'p-1', quantity: 10 }] };
      const expected = { id: 'po-2' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any, mockUser as any);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /purchases/purchase-orders/:id/confirm', () => {
    it('should call confirm with id and userId', async () => {
      const expected = { id: 'po-1', state: 'CONFIRMED' };
      service.confirm.mockResolvedValue(expected);

      const result = await controller.confirm('po-1', mockUser as any);

      expect(service.confirm).toHaveBeenCalledWith('po-1', mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /purchases/purchase-orders/:id/annul', () => {
    it('should call annul with id', async () => {
      const expected = { id: 'po-1', state: 'ANNULLED' };
      service.annul.mockResolvedValue(expected);

      const result = await controller.annul('po-1');

      expect(service.annul).toHaveBeenCalledWith('po-1');
      expect(result).toEqual(expected);
    });
  });
});
