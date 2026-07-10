// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  class MockDecimal {
    constructor(public value: string | number) {}
    plus(other: MockDecimal) {
      return new MockDecimal(Number(this.value) + Number(other.value));
    }
    times(other: MockDecimal) {
      return new MockDecimal(Number(this.value) * Number(other.value));
    }
    minus(other: MockDecimal) {
      return new MockDecimal(Number(this.value) - Number(other.value));
    }
    dividedBy(other: MockDecimal) {
      return new MockDecimal(Number(this.value) / Number(other.value));
    }
    toNumber() { return Number(this.value); }
  }
  return {
    PrismaClient: MockPrismaClient,
    Prisma: { Decimal: MockDecimal },
    PurchaseReceptionState: { DRAFT: 'DRAFT', CONFIRMED: 'CONFIRMED' },
    PurchaseOrderState: { CONFIRMED: 'CONFIRMED', PARTIALLY_RECEIVED: 'PARTIALLY_RECEIVED', FULLY_RECEIVED: 'FULLY_RECEIVED' },
  };
});

import { PurchaseReceptionsService } from './purchase-receptions.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';

// ── Mock objects ──────────────────────────────────────────────────────

function createTxMock() {
  return {
    supplier: { findUnique: jest.fn() },
    product: { findUnique: jest.fn() },
    purchaseOrder: { findUnique: jest.fn(), update: jest.fn() },
    purchaseOrderItem: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    purchaseReception: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    purchaseReceptionItem: { findFirst: jest.fn(), update: jest.fn() },
    lot: { findUnique: jest.fn() },
    fiscalDocument: { create: jest.fn() },
    invoiceTransmissionAttempt: { create: jest.fn() },
    receptionCreatedEvent: { create: jest.fn() },
  };
}

const mockTx = createTxMock();

const mockPurchaseReception = {
  findMany: jest.fn(),
  findUnique: jest.fn(),
  count: jest.fn(),
};

const mockPrisma = {
  purchaseReception: mockPurchaseReception,
  $transaction: jest.fn(),
} as unknown as PrismaService;

const mockLotsService = {
  receiveStock: jest.fn(),
} as unknown as LotsService;

const mockFiscalDocumentsService = {
  createPendingDocumentForPurchaseReception: jest.fn(),
  enqueueGenerationJob: jest.fn(),
} as unknown as FiscalDocumentsService;

const UUID = '00000000-0000-4000-8000-000000000001';

describe('PurchaseReceptionsService', () => {
  let service: PurchaseReceptionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore tx mocks by creating fresh ones
    Object.assign(mockTx, createTxMock());
    service = new PurchaseReceptionsService(mockPrisma, mockLotsService, mockFiscalDocumentsService);
  });

  // ── findAll ─────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated receptions with total count', async () => {
      const mockData = [{ id: 'r1', supplier: { id: 's1' } }];
      mockPrisma.$transaction.mockImplementation(async (promises: any) => Promise.all(promises));
      mockPurchaseReception.findMany.mockResolvedValue(mockData);
      mockPurchaseReception.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({ data: mockData, total: 1, page: 1, pageSize: 20 });
    });

    it('filters by supplierId when provided', async () => {
      mockPrisma.$transaction.mockImplementation(async (promises: any) => Promise.all(promises));
      mockPurchaseReception.findMany.mockResolvedValue([]);
      mockPurchaseReception.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, supplierId: 's1' });

      expect(mockPurchaseReception.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierId: 's1' } }),
      );
    });

    it('filters by state when provided', async () => {
      mockPrisma.$transaction.mockImplementation(async (promises: any) => Promise.all(promises));
      mockPurchaseReception.findMany.mockResolvedValue([]);
      mockPurchaseReception.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, state: 'DRAFT' });

      expect(mockPurchaseReception.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { state: 'DRAFT' } }),
      );
    });

    it('filters by date range when provided', async () => {
      mockPrisma.$transaction.mockImplementation(async (promises: any) => Promise.all(promises));
      mockPurchaseReception.findMany.mockResolvedValue([]);
      mockPurchaseReception.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, receivedAtFrom: '2026-07-01', receivedAtTo: '2026-07-10' });

      expect(mockPurchaseReception.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { receivedAt: { gte: expect.any(Date), lte: expect.any(Date) } },
        }),
      );
    });
  });

  // ── findById ────────────────────────────────────────────────────────

  describe('findById', () => {
    it('returns the reception when found', async () => {
      const mockReception = { id: 'r1', items: [] };
      mockPurchaseReception.findUnique.mockResolvedValue(mockReception);

      const result = await service.findById('r1');

      expect(result).toEqual(mockReception);
      expect(mockPurchaseReception.findUnique).toHaveBeenCalledWith({
        where: { id: 'r1' },
        include: { supplier: true, purchaseOrder: true, items: { include: { product: true, purchaseOrderItem: true } } },
      });
    });

    it('throws PurchaseReceptionNotFoundException when not found', async () => {
      mockPurchaseReception.findUnique.mockResolvedValue(null);

      await expect(service.findById('missing')).rejects.toThrow(/Purchase reception.*missing not found/);
    });
  });

  // ── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto = {
      supplierId: UUID,
      purchaseOrderId: UUID,
      notes: 'Test reception',
      items: [
        {
          productId: UUID,
          purchaseOrderItemId: UUID,
          receivedQuantity: 10,
          lotNumber: 'LOT-001',
          expirationDate: '2027-01-01T00:00:00Z',
          realUnitCost: 5000,
          taxSchemeId: UUID,
          taxRate: 19,
          discountAmount: 0,
        },
      ],
    };

    function configureSuccessMocks() {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID, name: 'Supplier' });
        mockTx.purchaseOrder.findUnique.mockResolvedValue({
          id: UUID,
          items: [{ id: UUID, productId: UUID, requestedQuantity: 20, receivedQuantity: 0 }],
        });
        mockTx.product.findUnique.mockResolvedValue({ id: UUID, name: 'Product' });
        mockTx.purchaseOrderItem.findUnique.mockResolvedValue({
          id: UUID, purchaseOrderId: UUID, productId: UUID,
          requestedQuantity: 20, receivedQuantity: 0,
        });
        mockTx.purchaseReception.findFirst.mockResolvedValue(null);
        mockTx.purchaseReception.create.mockResolvedValue({ id: 'new-reception' });
        return cb(mockTx);
      });
    }

    it('creates a DRAFT reception with items and valid supplier', async () => {
      configureSuccessMocks();

      const result = await service.create(validDto, 'user-1');

      expect(result).toEqual({ id: 'new-reception' });
      expect(mockTx.purchaseReception.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            state: 'DRAFT',
            supplierId: UUID,
            createdById: 'user-1',
          }),
        }),
      );
    });

    it('throws SupplierNotFoundException when supplier does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(/Supplier.*not found/);
    });

    it('throws PurchaseOrderNotFoundException when the order does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID });
        mockTx.purchaseOrder.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(/Purchase order.*not found/);
    });

    it('throws ProductNotFoundException when a product does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID });
        mockTx.purchaseOrder.findUnique.mockResolvedValue({ id: UUID, items: [] });
        mockTx.product.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(/Product.*not found/);
    });

    it('throws OverReceptionException when quantity exceeds pending order', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID });
        mockTx.purchaseOrder.findUnique.mockResolvedValue({ id: UUID, items: [] });
        mockTx.product.findUnique.mockResolvedValue({ id: UUID });
        mockTx.purchaseOrderItem.findUnique.mockResolvedValue({
          id: UUID, purchaseOrderId: UUID, productId: UUID,
          requestedQuantity: 5, receivedQuantity: 5, // 0 pending — cannot receive more
        });
        return cb(mockTx);
      });

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(/exceeds pending quantity/);
    });

    it('creates without purchaseOrderId when not provided', async () => {
      const dtoWithoutOrder = {
        supplierId: UUID,
        items: [{ productId: UUID, quantity: 10 }],
      };
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID });
        mockTx.product.findUnique.mockResolvedValue({ id: UUID });
        mockTx.purchaseReception.findFirst.mockResolvedValue(null);
        mockTx.purchaseReception.create.mockResolvedValue({ id: 'new-reception' });
        return cb(mockTx);
      });

      const result = await service.create(dtoWithoutOrder, 'user-1');

      expect(result).toEqual({ id: 'new-reception' });
      expect(mockTx.purchaseOrder.findUnique).not.toHaveBeenCalled();
    });
  });

  // ── confirm ──────────────────────────────────────────────────────────

  describe('confirm', () => {
    function configureConfirmMocks(receptionOverrides: Record<string, unknown> = {}) {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'DRAFT',
          items: [
            {
              id: 'item-1',
              productId: UUID,
              receivedQuantity: 10,
              realUnitCost: new (require('@pharmacy/database').Prisma.Decimal)(5000),
              lotNumber: 'LOT-001',
              expirationDate: new Date('2027-01-01'),
              purchaseOrderItemId: UUID,
              purchaseOrderItem: {
                id: UUID,
                requestedQuantity: 20,
                receivedQuantity: 0,
                pendingQuantity: 20,
              },
            },
          ],
          purchaseOrder: {
            id: UUID,
            state: 'CONFIRMED',
            items: [
              { id: UUID, requestedQuantity: 20, receivedQuantity: 0, pendingQuantity: 20 },
            ],
          },
          ...receptionOverrides,
        });
        mockTx.purchaseOrderItem.findMany.mockResolvedValue([
          { id: UUID, pendingQuantity: 0 }, // all received
        ]);
        mockTx.purchaseReception.update.mockResolvedValue({ id: 'r1', state: 'CONFIRMED' });
        mockLotsService.receiveStock.mockResolvedValue({ lotId: 'lot-1' });
        mockFiscalDocumentsService.createPendingDocumentForPurchaseReception
          .mockResolvedValue({ id: 'fd-1' });
        return cb(mockTx);
      });
      mockFiscalDocumentsService.enqueueGenerationJob.mockResolvedValue(undefined);
    }

    it('confirms a DRAFT reception, receives stock, creates fiscal doc, enqueues job', async () => {
      configureConfirmMocks();

      const result = await service.confirm('r1', 'user-1', 'ws-1');

      expect(result).toBeDefined();
      expect(mockLotsService.receiveStock).toHaveBeenCalledWith(
        expect.objectContaining({ productId: UUID, quantity: 10, tx: mockTx }),
      );
      expect(mockFiscalDocumentsService.createPendingDocumentForPurchaseReception)
        .toHaveBeenCalledWith({
          purchaseReceptionId: 'r1',
          workstationId: 'ws-1',
          tx: mockTx,
        });
      expect(mockFiscalDocumentsService.enqueueGenerationJob).toHaveBeenCalledWith('fd-1');
    });

    it('throws PurchaseReceptionNotFoundException when reception does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(service.confirm('missing', 'user-1', 'ws-1')).rejects.toThrow(/Purchase reception.*not found/);
    });

    it('throws PurchaseReceptionNotDraftException when not in DRAFT state', async () => {
      configureConfirmMocks({ state: 'CONFIRMED' });

      await expect(service.confirm('r1', 'user-1', 'ws-1')).rejects.toThrow(/not in DRAFT/);
    });

    it('throws Error when an item lacks expiration date', async () => {
      configureConfirmMocks({
        items: [{
          id: 'item-1',
          productId: UUID,
          receivedQuantity: 10,
          realUnitCost: new (require('@pharmacy/database').Prisma.Decimal)(5000),
          lotNumber: null,
          expirationDate: null,
          purchaseOrderItemId: UUID,
          purchaseOrderItem: { id: UUID, requestedQuantity: 20, receivedQuantity: 0, pendingQuantity: 20 },
        }],
      });

      await expect(service.confirm('r1', 'user-1', 'ws-1')).rejects.toThrow('missing expiration date');
    });
  });

  // ── annul ────────────────────────────────────────────────────────────

  describe('annul', () => {
    it('throws Error as annulment is not implemented', async () => {
      await expect(service.annul('r1')).rejects.toThrow('Annulment not implemented for this phase.');
    });
  });
});
