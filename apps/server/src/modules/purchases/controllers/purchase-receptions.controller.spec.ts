jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { PurchaseReceptionsController } from './purchase-receptions.controller';
import { PurchaseReceptionsService } from '../services/purchase-receptions.service';

const mockService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  confirm: jest.fn(),
  annul: jest.fn(),
};

const mockUser = { id: 'user-1', role: 'INVENTORY_ASSISTANT' };

describe('PurchaseReceptionsController (integration)', () => {
  let controller: PurchaseReceptionsController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PurchaseReceptionsController],
      providers: [{ provide: PurchaseReceptionsService, useValue: mockService }],
    }).compile();

    controller = module.get<PurchaseReceptionsController>(PurchaseReceptionsController);
    service = module.get(PurchaseReceptionsService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /purchases/receptions', () => {
    it('should call findAll with query', async () => {
      const query = { purchaseOrderId: 'po-1' };
      const expected = { data: [{ id: 'rec-1' }], total: 1 };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query as any);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /purchases/receptions/:id', () => {
    it('should call findById with id', async () => {
      const expected = { id: 'rec-1', purchaseOrderId: 'po-1' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById('rec-1');

      expect(service.findById).toHaveBeenCalledWith('rec-1');
      expect(result).toEqual(expected);
    });

    it('should propagate not found', async () => {
      service.findById.mockRejectedValue(new Error('not found'));

      await expect(controller.findById('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('POST /purchases/receptions', () => {
    it('should call create with DTO and userId', async () => {
      const dto = { purchaseOrderId: 'po-1', items: [{ productId: 'p-1', quantity: 10 }] };
      const expected = { id: 'rec-2' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any, mockUser as any);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /purchases/receptions/:id/confirm', () => {
    it('should call confirm with id, userId and workstationId from header', async () => {
      const expected = { id: 'rec-1', state: 'CONFIRMED' };
      service.confirm.mockResolvedValue(expected);

      const result = await controller.confirm('rec-1', mockUser as any, 'ws-1');

      expect(service.confirm).toHaveBeenCalledWith('rec-1', mockUser.id, 'ws-1');
      expect(result).toEqual(expected);
    });

    it('should pass empty string when workstationId header missing', async () => {
      service.confirm.mockResolvedValue({ id: 'rec-1', state: 'CONFIRMED' });

      await controller.confirm('rec-1', mockUser as any, undefined);

      expect(service.confirm).toHaveBeenCalledWith('rec-1', mockUser.id, '');
    });
  });

  describe('POST /purchases/receptions/:id/annul', () => {
    it('should call annul with id and userId', async () => {
      service.annul.mockResolvedValue(undefined);

      await controller.annul('rec-1', mockUser as any);

      expect(service.annul).toHaveBeenCalledWith('rec-1', mockUser.id);
    });
  });
});
