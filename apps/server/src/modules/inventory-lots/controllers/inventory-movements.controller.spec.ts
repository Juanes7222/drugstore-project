jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { InventoryMovementsController } from './inventory-movements.controller';
import { InventoryMovementsService } from '../services/inventory-movements.service';

const mockService = {
  findAll: jest.fn(),
};

describe('InventoryMovementsController (integration)', () => {
  let controller: InventoryMovementsController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InventoryMovementsController],
      providers: [{ provide: InventoryMovementsService, useValue: mockService }],
    }).compile();

    controller = module.get<InventoryMovementsController>(InventoryMovementsController);
    service = module.get(InventoryMovementsService) as jest.Mocked<typeof mockService>;
  });

  describe('GET /inventory-lots/movements', () => {
    it('should call findAll with the query and return result', async () => {
      const query = { lotId: 'lot-1', movementType: 'SALE' };
      const expected = [{ id: 'm-1', lotId: 'lot-1', quantity: -5 }];
      service.findAll.mockResolvedValue(expected);

      const result = await controller.findAll(query as any);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(expected);
    });

    it('should call findAll with empty query when no params provided', async () => {
      service.findAll.mockResolvedValue([]);

      const result = await controller.findAll({} as any);

      expect(service.findAll).toHaveBeenCalledWith({});
      expect(result).toEqual([]);
    });
  });
});
