// Mock @prisma/client before any imports that depend on it
jest.mock('@prisma/client', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { LotsController } from './lots.controller';
import { LotsService } from '../services/lots.service';
import { QueryLotDto } from '../dto/query-lot.dto';
import { QueryInventoryMovementDto } from '../dto/query-inventory-movement.dto';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildMockUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-uuid-1',
    username: 'admin',
    role: 'ADMIN' as const,
    isActive: true,
    ...overrides,
  };
}

function buildMockLot(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'lot-uuid-1',
    batchNumber: 'LOTE-001',
    productId: 'prod-uuid-1',
    currentStock: 100,
    version: 0,
    state: 'ACTIVE' as const,
    expirationDate: new Date('2027-12-31'),
    entryDate: new Date('2026-01-15'),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLotsService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  blockLot: jest.fn(),
  unblockLot: jest.fn(),
  listMovements: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LotsController (integration)', () => {
  let controller: LotsController;
  let service: jest.Mocked<typeof mockLotsService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [LotsController],
      providers: [
        { provide: LotsService, useValue: mockLotsService },
      ],
    }).compile();

    controller = module.get<LotsController>(LotsController);
    service = module.get(LotsService) as jest.Mocked<typeof mockLotsService>;
  });

  // -----------------------------------------------------------------------
  // GET /inventory-lots/lots
  // -----------------------------------------------------------------------
  describe('GET /inventory-lots/lots', () => {
    it('should return paginated lots', async () => {
      const lots = [buildMockLot()];
      const paginatedResult = {
        data: lots,
        total: 1,
        page: 1,
        pageSize: 20,
      };
      service.findAll.mockResolvedValue(paginatedResult);

      const query = new QueryLotDto();
      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(paginatedResult);
    });

    it('should pass query filters to service', async () => {
      service.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 10,
      });

      const query = Object.assign(new QueryLotDto(), {
        productId: 'prod-1',
        state: 'ACTIVE' as const,
        page: 1,
        pageSize: 10,
      });
      await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
    });
  });

  // -----------------------------------------------------------------------
  // GET /inventory-lots/lots/:id
  // -----------------------------------------------------------------------
  describe('GET /inventory-lots/lots/:id', () => {
    it('should return lot by id', async () => {
      const lot = buildMockLot({ id: 'lot-123' });
      service.findById.mockResolvedValue(lot);

      const result = await controller.findById('lot-123');

      expect(service.findById).toHaveBeenCalledWith('lot-123');
      expect(result).toEqual(lot);
    });

    it('should propagate LotNotFoundException', async () => {
      service.findById.mockRejectedValue(new Error('Lot not found'));

      await expect(controller.findById('nonexistent')).rejects.toThrow(
        'Lot not found',
      );
    });
  });

  // -----------------------------------------------------------------------
  // POST /inventory-lots/lots/:id/block
  // -----------------------------------------------------------------------
  describe('POST /inventory-lots/lots/:id/block', () => {
    const blockDto = { reason: 'Control de calidad' };

    it('should call blockLot with id, dto, and userId', async () => {
      const blocked = buildMockLot({
        id: 'lot-123',
        state: 'BLOCKED',
        blockReason: 'Control de calidad',
      });
      service.blockLot.mockResolvedValue(blocked);

      const user = buildMockUser();
      const result = await controller.blockLot('lot-123', blockDto, user as any);

      expect(service.blockLot).toHaveBeenCalledWith('lot-123', blockDto, user.id);
      expect(result).toEqual(blocked);
    });

    it('should propagate LotNotActiveException', async () => {
      service.blockLot.mockRejectedValue(
        new Error('Only ACTIVE lots can be blocked'),
      );

      await expect(
        controller.blockLot('lot-123', blockDto, buildMockUser() as any),
      ).rejects.toThrow('Only ACTIVE lots can be blocked');
    });
  });

  // -----------------------------------------------------------------------
  // POST /inventory-lots/lots/:id/unblock
  // -----------------------------------------------------------------------
  describe('POST /inventory-lots/lots/:id/unblock', () => {
    it('should call unblockLot with id and userId', async () => {
      const unblocked = buildMockLot({
        id: 'lot-123',
        state: 'ACTIVE',
        blockedAt: null,
      });
      service.unblockLot.mockResolvedValue(unblocked);

      const user = buildMockUser();
      const result = await controller.unblockLot('lot-123', user as any);

      expect(service.unblockLot).toHaveBeenCalledWith('lot-123', user.id);
      expect(result).toEqual(unblocked);
    });

    it('should propagate LotNotBlockedException', async () => {
      service.unblockLot.mockRejectedValue(
        new Error('Only BLOCKED lots can be unblocked'),
      );

      await expect(
        controller.unblockLot('lot-123', buildMockUser() as any),
      ).rejects.toThrow('Only BLOCKED lots can be unblocked');
    });
  });

  // -----------------------------------------------------------------------
  // GET /inventory-lots/lots/movements
  // -----------------------------------------------------------------------
  describe('GET /inventory-lots/lots/movements', () => {
    it('should return paginated movements', async () => {
      const movements = {
        data: [
          {
            id: 'mov-1',
            movementType: 'SALE' as const,
            quantity: 10,
            lotId: 'lot-123',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      };
      service.listMovements.mockResolvedValue(movements);

      const query = new QueryInventoryMovementDto();
      const result = await controller.listMovements(query);

      expect(service.listMovements).toHaveBeenCalledWith(query);
      expect(result).toEqual(movements);
    });

    it('should pass movement filters to service', async () => {
      service.listMovements.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });

      const query = Object.assign(new QueryInventoryMovementDto(), {
        lotId: 'lot-123',
        movementType: 'SALE' as const,
      });
      await controller.listMovements(query);

      expect(service.listMovements).toHaveBeenCalledWith(query);
    });
  });
});
