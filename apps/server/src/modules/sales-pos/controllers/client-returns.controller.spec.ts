// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { ClientReturnsController } from './client-returns.controller';
import { ClientReturnsService } from '../services/client-returns.service';

// ---------------------------------------------------------------------------
// Factory helpers
// ---------------------------------------------------------------------------

function buildMockUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'user-uuid-1',
    username: 'cashier1',
    role: 'CASHIER' as const,
    isActive: true,
    workstationId: 'ws-1',
    ...overrides,
  };
}

function buildMockClientReturn(
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id: 'return-uuid-1',
    state: 'DRAFT' as const,
    saleId: 'sale-uuid-1',
    clientId: 'client-uuid-1',
    refundAmount: 11900,
    subtotalReturned: 10000,
    taxReturned: 1900,
    reason: 'Producto defectuoso',
    createdAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockClientReturnsService = {
  findAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  markPendingPickup: jest.fn(),
  confirm: jest.fn(),
  reject: jest.fn(),
  annul: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClientReturnsController (integration)', () => {
  let controller: ClientReturnsController;
  let service: jest.Mocked<typeof mockClientReturnsService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ClientReturnsController],
      providers: [
        { provide: ClientReturnsService, useValue: mockClientReturnsService },
      ],
    }).compile();

    controller = module.get<ClientReturnsController>(ClientReturnsController);
    service = module.get(
      ClientReturnsService,
    ) as jest.Mocked<typeof mockClientReturnsService>;
  });

  // -----------------------------------------------------------------------
  // GET /sales-pos/client-returns
  // -----------------------------------------------------------------------
  describe('GET /sales-pos/client-returns', () => {
    it('should return paginated returns', async () => {
      const returns = [buildMockClientReturn()];
      const paginatedResult = { data: returns, total: 1, page: 1, pageSize: 20 };
      service.findAll.mockResolvedValue(paginatedResult);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalledWith({
        page: undefined,
        pageSize: undefined,
        state: undefined,
      });
      expect(result).toEqual(paginatedResult);
    });

    it('should pass query params as numbers', async () => {
      service.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 2,
        pageSize: 10,
      });

      await controller.findAll('2', '10', 'DRAFT');

      expect(service.findAll).toHaveBeenCalledWith({
        page: 2,
        pageSize: 10,
        state: 'DRAFT',
      });
    });
  });

  // -----------------------------------------------------------------------
  // GET /sales-pos/client-returns/:id
  // -----------------------------------------------------------------------
  describe('GET /sales-pos/client-returns/:id', () => {
    it('should return return by id', async () => {
      const ret = buildMockClientReturn({ id: 'return-123' });
      service.findOne.mockResolvedValue(ret);

      const result = await controller.findOne('return-123');

      expect(service.findOne).toHaveBeenCalledWith('return-123');
      expect(result).toEqual(ret);
    });

    it('should propagate ClientReturnNotFoundException', async () => {
      service.findOne.mockRejectedValue(new Error('Client return not found'));

      await expect(controller.findOne('nonexistent')).rejects.toThrow(
        'Client return not found',
      );
    });
  });

  // -----------------------------------------------------------------------
  // POST /sales-pos/client-returns
  // -----------------------------------------------------------------------
  describe('POST /sales-pos/client-returns', () => {
    const createDto = {
      saleId: 'sale-uuid-1',
      reason: 'Producto defectuoso',
      items: [
        { saleItemId: 'item-uuid-1', quantity: 1 },
      ],
    };

    it('should call create with dto, userId, and workstationId', async () => {
      const created = buildMockClientReturn({ id: 'new-return-uuid' });
      service.create.mockResolvedValue(created);

      const user = buildMockUser();
      const result = await controller.create(createDto, user as any);

      expect(service.create).toHaveBeenCalledWith(
        createDto,
        user.id,
        (user as any).workstationId,
      );
      expect(result).toEqual(created);
    });

    it('should propagate error when sale is not confirmed', async () => {
      service.create.mockRejectedValue(
        new Error('Only confirmed sales can have returns'),
      );

      await expect(
        controller.create(createDto, buildMockUser() as any),
      ).rejects.toThrow('Only confirmed sales can have returns');
    });
  });

  // -----------------------------------------------------------------------
  // POST /sales-pos/client-returns/:id/pending-pickup
  // -----------------------------------------------------------------------
  describe('POST /sales-pos/client-returns/:id/pending-pickup', () => {
    it('should call markPendingPickup with id', async () => {
      const pending = buildMockClientReturn({
        id: 'return-123',
        state: 'PENDING_PICKUP' as const,
      });
      service.markPendingPickup.mockResolvedValue(pending);

      const result = await controller.markPendingPickup('return-123');

      expect(service.markPendingPickup).toHaveBeenCalledWith('return-123');
      expect(result).toEqual(pending);
    });
  });

  // -----------------------------------------------------------------------
  // POST /sales-pos/client-returns/:id/confirm
  // -----------------------------------------------------------------------
  describe('POST /sales-pos/client-returns/:id/confirm', () => {
    it('should call confirm with id and userId', async () => {
      const confirmed = buildMockClientReturn({
        id: 'return-123',
        state: 'CONFIRMED' as const,
      });
      service.confirm.mockResolvedValue(confirmed);

      const user = buildMockUser();
      const result = await controller.confirm('return-123', user as any);

      expect(service.confirm).toHaveBeenCalledWith('return-123', user.id);
      expect(result).toEqual(confirmed);
    });

    it('should propagate error when return is not in DRAFT state', async () => {
      service.confirm.mockRejectedValue(
        new Error('Only DRAFT returns can be confirmed'),
      );

      await expect(
        controller.confirm('return-123', buildMockUser() as any),
      ).rejects.toThrow('Only DRAFT returns can be confirmed');
    });
  });

  // -----------------------------------------------------------------------
  // POST /sales-pos/client-returns/:id/reject
  // -----------------------------------------------------------------------
  describe('POST /sales-pos/client-returns/:id/reject', () => {
    const rejectDto = { reason: 'Producto en buen estado' };

    it('should call reject with id and dto', async () => {
      const rejected = buildMockClientReturn({
        id: 'return-123',
        state: 'REJECTED' as const,
      });
      service.reject.mockResolvedValue(rejected);

      const result = await controller.reject('return-123', rejectDto);

      expect(service.reject).toHaveBeenCalledWith('return-123', rejectDto);
      expect(result).toEqual(rejected);
    });
  });

  // -----------------------------------------------------------------------
  // POST /sales-pos/client-returns/:id/annul
  // -----------------------------------------------------------------------
  describe('POST /sales-pos/client-returns/:id/annul', () => {
    const annulDto = { annulmentReason: 'Error administrativo' };

    it('should call annul with id, userId, and dto', async () => {
      const annulled = buildMockClientReturn({
        id: 'return-123',
        state: 'ANNULLED' as const,
      });
      service.annul.mockResolvedValue(annulled);

      const user = buildMockUser();
      const result = await controller.annul('return-123', annulDto, user as any);

      expect(service.annul).toHaveBeenCalledWith('return-123', user.id, annulDto);
      expect(result).toEqual(annulled);
    });

    it('should propagate ClientReturnCannotBeAnnulledException', async () => {
      service.annul.mockRejectedValue(
        new Error('Confirmed returns cannot be annulled'),
      );

      await expect(
        controller.annul('return-123', annulDto, buildMockUser() as any),
      ).rejects.toThrow('Confirmed returns cannot be annulled');
    });
  });
});
