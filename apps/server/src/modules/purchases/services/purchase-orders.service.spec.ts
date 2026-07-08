import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrderNotFoundException } from '../exceptions/purchase-order-not-found.exception';
import { PurchaseOrderNotDraftException } from '../exceptions/purchase-order-not-draft.exception';
import { SupplierNotFoundException } from '../exceptions/supplier-not-found.exception';
import { ProductNotFoundException } from '@/modules/catalog/exceptions/product-not-found.exception';

jest.mock('@pharmacy/database', () => {
  class Decimal {
    constructor(private v: any) { /* mock */ }
    toString(): string { return String(this.v); }
    toNumber(): number { return Number(this.v); }
    valueOf(): number { return Number(this.v); }
    times(o: any): Decimal { return new Decimal(Number(this.v) * Number(o)); }
    dividedBy(o: any): Decimal { return new Decimal(Number(this.v) / Number(o)); }
    plus(o: any): Decimal { return new Decimal(Number(this.v) + Number(o)); }
    minus(o: any): Decimal { return new Decimal(Number(this.v) - Number(o)); }
  }
  return {
    PrismaClient: jest.fn(),
    PurchaseOrderState: {
      DRAFT: 'DRAFT',
      CONFIRMED: 'CONFIRMED',
      PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED',
      FULLY_RECEIVED: 'FULLY_RECEIVED',
      ANNULLED: 'ANNULLED',
    },
    Prisma: {
      Decimal,
    },
  };
});

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockSupplier = {
    id: 'supplier-1',
    businessName: 'Pharma Supply Co.',
    identificationType: 'NIT',
    identificationNumber: '900123456-7',
  };

  const mockProduct = { id: 'prod-1' };
  const mockProduct2 = { id: 'prod-2' };

  const mockPurchaseOrder = {
    id: 'po-1',
    sequentialNumber: 1,
    state: 'DRAFT',
    supplierId: 'supplier-1',
    expectedDeliveryDate: null,
    notes: 'Test order',
    subtotal: new (jest.requireMock('@pharmacy/database').Prisma.Decimal)(50000),
    totalTax: new (jest.requireMock('@pharmacy/database').Prisma.Decimal)(0),
    totalAmount: new (jest.requireMock('@pharmacy/database').Prisma.Decimal)(50000),
    createdById: 'user-1',
    confirmedAt: null,
    confirmedById: null,
    createdAt: new Date('2026-01-15'),
    updatedAt: new Date('2026-01-15'),
  };

  const mockPurchaseOrderItem = {
    id: 'poi-1',
    purchaseOrderId: 'po-1',
    productId: 'prod-1',
    requestedQuantity: 10,
    receivedQuantity: 0,
    pendingQuantity: 10,
    expectedUnitCost: new (jest.requireMock('@pharmacy/database').Prisma.Decimal)(5000),
  };

  function setupTransactionMock(): void {
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') return cb(prisma);
      return cb;
    });
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new PurchaseOrdersService(prisma as any);
  });

  // -------------------------------------------------------------------------
  // findAll
  // -------------------------------------------------------------------------
  describe('findAll', () => {
    function mockFindAll(result: any[] = [], total: number = 0): void {
      (prisma.$transaction as jest.Mock).mockResolvedValue([result, total]);
    }

    it('returns paginated purchase orders with supplier and items', async () => {
      const orderWithIncludes = {
        ...mockPurchaseOrder,
        supplier: mockSupplier,
        items: [mockPurchaseOrderItem],
      };
      mockFindAll([orderWithIncludes], 1);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({
        data: [orderWithIncludes],
        total: 1,
        page: 1,
        pageSize: 20,
      });
      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith({
        where: {},
        skip: 0,
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { supplier: true, items: true },
      });
    });

    it('filters by supplierId', async () => {
      mockFindAll();

      await service.findAll({ page: 1, pageSize: 20, supplierId: 'supplier-1' });

      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ supplierId: 'supplier-1' }),
        }),
      );
    });

    it('filters by state', async () => {
      mockFindAll();

      await service.findAll({ page: 1, pageSize: 20, state: 'CONFIRMED' });

      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ state: 'CONFIRMED' }),
        }),
      );
    });

    it('filters by date range when createdAtFrom and createdAtTo are provided', async () => {
      mockFindAll();

      await service.findAll({
        page: 1,
        pageSize: 20,
        createdAtFrom: '2026-01-01T00:00:00.000Z',
        createdAtTo: '2026-01-31T00:00:00.000Z',
      });

      expect(prisma.purchaseOrder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({
              gte: expect.any(Date),
              lte: expect.any(Date),
            }),
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // findById
  // -------------------------------------------------------------------------
  describe('findById', () => {
    it('returns the purchase order with full includes when found', async () => {
      const fullOrder = {
        ...mockPurchaseOrder,
        supplier: mockSupplier,
        items: [{ ...mockPurchaseOrderItem, product: mockProduct }],
      };
      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(fullOrder);

      const result = await service.findById('po-1');

      expect(result).toEqual(fullOrder);
      expect(prisma.purchaseOrder.findUnique).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        include: { supplier: true, items: { include: { product: true } } },
      });
    });

    it('throws PurchaseOrderNotFoundException when not found', async () => {
      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('unknown')).rejects.toThrow(PurchaseOrderNotFoundException);
    });
  });

  // -------------------------------------------------------------------------
  // create
  // -------------------------------------------------------------------------
  describe('create', () => {
    const createDto = {
      supplierId: 'supplier-1',
      notes: 'Test order',
      items: [
        { productId: 'prod-1', requestedQuantity: 10, expectedUnitCost: 5000 },
        { productId: 'prod-2', requestedQuantity: 5, expectedUnitCost: 3000 },
      ],
    };

    it('creates a purchase order with items and calculated totals', async () => {
      setupTransactionMock();
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockProduct)
        .mockResolvedValueOnce(mockProduct2);
      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.purchaseOrder.create as jest.Mock).mockResolvedValue(mockPurchaseOrder);

      const result = await service.create(createDto, 'user-1');

      expect(result).toEqual(mockPurchaseOrder);
      // subtotal = (10 * 5000) + (5 * 3000) = 50000 + 15000 = 65000
      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          id: expect.any(String),
          sequentialNumber: 1,
          state: 'DRAFT',
          supplierId: 'supplier-1',
          notes: 'Test order',
          createdById: 'user-1',
        }),
      });
    });

    it('throws SupplierNotFoundException when supplier does not exist', async () => {
      setupTransactionMock();
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.create(createDto, 'user-1')).rejects.toThrow(SupplierNotFoundException);
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('throws ProductNotFoundException when a product does not exist', async () => {
      setupTransactionMock();
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findUnique as jest.Mock)
        .mockResolvedValueOnce(mockProduct)
        .mockResolvedValueOnce(null); // product-2 not found

      await expect(service.create(createDto, 'user-1')).rejects.toThrow(ProductNotFoundException);
      expect(prisma.purchaseOrder.create).not.toHaveBeenCalled();
    });

    it('auto-increments sequentialNumber based on the latest order', async () => {
      setupTransactionMock();
      (prisma.supplier.findUnique as jest.Mock).mockResolvedValue(mockSupplier);
      (prisma.product.findUnique as jest.Mock)
        .mockResolvedValue(mockProduct)
        .mockResolvedValue(mockProduct2);
      (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue({ sequentialNumber: 5 });
      (prisma.purchaseOrder.create as jest.Mock).mockResolvedValue(mockPurchaseOrder);

      await service.create(createDto, 'user-1');

      expect(prisma.purchaseOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sequentialNumber: 6 }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // confirm
  // -------------------------------------------------------------------------
  describe('confirm', () => {
    it('confirms a DRAFT purchase order', async () => {
      setupTransactionMock();
      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
        ...mockPurchaseOrder,
        items: [mockPurchaseOrderItem],
      });
      (prisma.purchaseOrder.update as jest.Mock).mockResolvedValue({
        ...mockPurchaseOrder,
        state: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedById: 'user-1',
      });

      const result = await service.confirm('po-1', 'user-1');

      expect(result.state).toBe('CONFIRMED');
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith({
        where: { id: 'po-1' },
        data: expect.objectContaining({
          state: 'CONFIRMED',
          confirmedById: 'user-1',
        }),
      });
    });

    it('throws PurchaseOrderNotFoundException when not found', async () => {
      setupTransactionMock();
      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.confirm('unknown', 'user-1')).rejects.toThrow(
        PurchaseOrderNotFoundException,
      );
    });

    it('throws PurchaseOrderNotDraftException when order is not in DRAFT state', async () => {
      setupTransactionMock();
      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
        ...mockPurchaseOrder,
        state: 'CONFIRMED',
        items: [mockPurchaseOrderItem],
      });

      await expect(service.confirm('po-1', 'user-1')).rejects.toThrow(
        PurchaseOrderNotDraftException,
      );
    });

    it('throws an error when purchase order has no items', async () => {
      setupTransactionMock();
      (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue({
        ...mockPurchaseOrder,
        items: [],
      });

      await expect(service.confirm('po-1', 'user-1')).rejects.toThrow(
        'Purchase order must have at least one item to be confirmed.',
      );
    });
  });

  // -------------------------------------------------------------------------
  // annul
  // -------------------------------------------------------------------------
  describe('annul', () => {
    it('throws an error indicating annulment is not implemented', async () => {
      await expect(service.annul('po-1')).rejects.toThrow(
        'Annulment not implemented for this phase.',
      );
    });
  });
});
