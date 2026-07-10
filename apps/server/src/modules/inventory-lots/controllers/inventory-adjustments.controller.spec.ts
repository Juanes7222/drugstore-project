jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { InventoryAdjustmentsController } from './inventory-adjustments.controller';
import { InventoryAdjustmentsService } from '../services/inventory-adjustments.service';

const mockService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  submit: jest.fn(),
  approve: jest.fn(),
  reject: jest.fn(),
  apply: jest.fn(),
  annul: jest.fn(),
};

const mockUser = { id: 'user-1', role: 'INVENTORY_ASSISTANT' };

describe('InventoryAdjustmentsController (integration)', () => {
  let controller: InventoryAdjustmentsController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryAdjustmentsController],
      providers: [{ provide: InventoryAdjustmentsService, useValue: mockService }],
    }).compile();

    controller = module.get<InventoryAdjustmentsController>(InventoryAdjustmentsController);
    service = module.get(InventoryAdjustmentsService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /inventory-lots/adjustments', () => {
    it('should call findAll with query', async () => {
      const query = { state: 'DRAFT', page: 1, pageSize: 20 };
      const expected = { data: [{ id: 'adj-1' }], total: 1 };
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query as any);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /inventory-lots/adjustments/:id', () => {
    it('should call findById with the id', async () => {
      const expected = { id: 'adj-1', state: 'DRAFT' };
      service.findById.mockResolvedValue(expected);

      const result = await controller.findById('adj-1');

      expect(service.findById).toHaveBeenCalledWith('adj-1');
      expect(result).toEqual(expected);
    });

    it('should propagate not found', async () => {
      service.findById.mockRejectedValue(new Error('not found'));

      await expect(controller.findById('bad-id')).rejects.toThrow('not found');
    });
  });

  describe('POST /inventory-lots/adjustments', () => {
    it('should call create with DTO and userId', async () => {
      const dto = { items: [{ lotId: 'lot-1', quantity: 10, movementType: 'POSITIVE_ADJUSTMENT' }] };
      const expected = { id: 'adj-2', state: 'DRAFT' };
      service.create.mockResolvedValue(expected);

      const result = await controller.create(dto as any, mockUser as any);

      expect(service.create).toHaveBeenCalledWith(dto, mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/adjustments/:id/submit', () => {
    it('should call submit with id and userId', async () => {
      const expected = { id: 'adj-1', state: 'PENDING_APPROVAL' };
      service.submit.mockResolvedValue(expected);

      const result = await controller.submit('adj-1', mockUser as any);

      expect(service.submit).toHaveBeenCalledWith('adj-1', mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/adjustments/:id/approve', () => {
    it('should call approve with id, userId and DTO', async () => {
      const dto = { approvedQuantity: 10 };
      const expected = { id: 'adj-1', state: 'APPROVED' };
      service.approve.mockResolvedValue(expected);

      const result = await controller.approve('adj-1', dto as any, mockUser as any);

      expect(service.approve).toHaveBeenCalledWith('adj-1', mockUser.id, dto);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/adjustments/:id/reject', () => {
    it('should call reject with id, userId and DTO', async () => {
      const dto = { reason: 'Stock discrepancy too large' };
      const expected = { id: 'adj-1', state: 'REJECTED' };
      service.reject.mockResolvedValue(expected);

      const result = await controller.reject('adj-1', dto as any, mockUser as any);

      expect(service.reject).toHaveBeenCalledWith('adj-1', mockUser.id, dto);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/adjustments/:id/apply', () => {
    it('should call apply with id and userId', async () => {
      const expected = { id: 'adj-1', state: 'APPLIED' };
      service.apply.mockResolvedValue(expected);

      const result = await controller.apply('adj-1', mockUser as any);

      expect(service.apply).toHaveBeenCalledWith('adj-1', mockUser.id);
      expect(result).toEqual(expected);
    });
  });

  describe('POST /inventory-lots/adjustments/:id/annul', () => {
    it('should call annul with id, userId and DTO', async () => {
      const dto = { annulmentReason: 'Created by mistake' };
      const expected = { id: 'adj-1', state: 'ANNULLED' };
      service.annul.mockResolvedValue(expected);

      const result = await controller.annul('adj-1', dto as any, mockUser as any);

      expect(service.annul).toHaveBeenCalledWith('adj-1', mockUser.id, dto);
      expect(result).toEqual(expected);
    });
  });
});
