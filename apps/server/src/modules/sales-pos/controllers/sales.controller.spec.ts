// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { SalesController } from './sales.controller';
import { SalesService } from '../services/sales.service';
import { QuerySaleDto } from '../dto/query-sale.dto';

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

function buildMockSale(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'sale-uuid-1',
    localNumber: 1n,
    operationalState: 'IN_PROGRESS' as const,
    subtotal: '10000.00',
    totalDiscount: '0.00',
    totalTax: '1900.00',
    totalAmount: '11900.00',
    cashShiftId: 'shift-uuid-1',
    workstationId: 'ws-1',
    userId: 'user-uuid-1',
    startedAt: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSalesService = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  confirm: jest.fn(),
  annul: jest.fn(),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SalesController (integration)', () => {
  let controller: SalesController;
  let service: jest.Mocked<typeof mockSalesService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SalesController],
      providers: [
        { provide: SalesService, useValue: mockSalesService },
      ],
    }).compile();

    controller = module.get<SalesController>(SalesController);
    service = module.get(SalesService) as jest.Mocked<typeof mockSalesService>;
  });

  // -----------------------------------------------------------------------
  // GET /sales-pos
  // -----------------------------------------------------------------------
  describe('GET /sales-pos', () => {
    it('should return paginated sales with default query', async () => {
      const sales = [buildMockSale()];
      const paginatedResult = {
        data: sales,
        total: 1,
        page: 1,
        pageSize: 20,
      };
      service.findAll.mockResolvedValue(paginatedResult);

      const query = new QuerySaleDto();
      const result = await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
      expect(result).toEqual(paginatedResult);
    });

    it('should pass query filters to service', async () => {
      service.findAll.mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 10 });

      const query = Object.assign(new QuerySaleDto(), {
        cashShiftId: 'shift-1',
        operationalState: 'CONFIRMED' as const,
        page: 1,
        pageSize: 10,
      });
      await controller.findAll(query);

      expect(service.findAll).toHaveBeenCalledWith(query);
    });
  });

  // -----------------------------------------------------------------------
  // GET /sales-pos/:id
  // -----------------------------------------------------------------------
  describe('GET /sales-pos/:id', () => {
    it('should return sale by id', async () => {
      const sale = buildMockSale({ id: 'sale-123' });
      service.findById.mockResolvedValue(sale);

      const result = await controller.findById('sale-123');

      expect(service.findById).toHaveBeenCalledWith('sale-123');
      expect(result).toEqual(sale);
    });

    it('should propagate SaleNotFoundException', async () => {
      service.findById.mockRejectedValue(new Error('Sale not found'));

      await expect(controller.findById('nonexistent')).rejects.toThrow(
        'Sale not found',
      );
    });
  });

  // -----------------------------------------------------------------------
  // POST /sales-pos
  // -----------------------------------------------------------------------
  describe('POST /sales-pos', () => {
    const createDto = {
      saleType: 'FREE_SALE' as const,
      cashShiftId: 'shift-uuid-1',
      items: [
        { productId: 'prod-uuid-1', quantity: 2, unitPrice: '5000.00' },
      ],
    };

    it('should call create with dto, userId, and workstationId', async () => {
      const created = buildMockSale({ id: 'new-sale-uuid' });
      service.create.mockResolvedValue(created);

      const user = buildMockUser();
      const result = await controller.create(createDto, user as any, 'ws-1');

      expect(service.create).toHaveBeenCalledWith(
        createDto,
        user.id,
        'ws-1',
      );
      expect(result).toEqual(created);
    });

    it('should propagate error when no open cash shift', async () => {
      service.create.mockRejectedValue(
        new Error('No open cash shift for workstation'),
      );

      await expect(
        controller.create(createDto, buildMockUser() as any),
      ).rejects.toThrow('No open cash shift for workstation');
    });
  });

  // -----------------------------------------------------------------------
  // POST /sales-pos/:id/confirm
  // -----------------------------------------------------------------------
  describe('POST /sales-pos/:id/confirm', () => {
    const confirmDto = {
      payments: [
        { paymentMethodId: 'pm-uuid-1', amount: 11900 },
      ],
    };

    it('should call confirm with id, dto, and userId', async () => {
      const confirmed = buildMockSale({
        id: 'sale-123',
        operationalState: 'CONFIRMED',
      });
      service.confirm.mockResolvedValue(confirmed);

      const user = buildMockUser();
      const result = await controller.confirm('sale-123', confirmDto, user as any);

      expect(service.confirm).toHaveBeenCalledWith('sale-123', confirmDto, user.id);
      expect(result).toEqual(confirmed);
    });

    it('should propagate error when payment amount mismatches', async () => {
      service.confirm.mockRejectedValue(
        new Error('Payment amount does not match total'),
      );

      await expect(
        controller.confirm(
          'sale-123',
          confirmDto,
          buildMockUser() as any,
        ),
      ).rejects.toThrow('Payment amount does not match total');
    });
  });

  // -----------------------------------------------------------------------
  // POST /sales-pos/:id/annul
  // -----------------------------------------------------------------------
  describe('POST /sales-pos/:id/annul', () => {
    const annulDto = { annulmentReason: 'Cliente canceló la compra' };

    it('should call annul with id, dto, and userId', async () => {
      const annulled = buildMockSale({
        id: 'sale-123',
        operationalState: 'ANNULLED',
      });
      service.annul.mockResolvedValue(annulled);

      const user = buildMockUser();
      const result = await controller.annul('sale-123', annulDto, user as any);

      expect(service.annul).toHaveBeenCalledWith('sale-123', annulDto, user.id);
      expect(result).toEqual(annulled);
    });

    it('should propagate error when sale is not confirmed', async () => {
      service.annul.mockRejectedValue(
        new Error('Only confirmed sales can be annulled'),
      );

      await expect(
        controller.annul('sale-123', annulDto, buildMockUser() as any),
      ).rejects.toThrow('Only confirmed sales can be annulled');
    });
  });
});
