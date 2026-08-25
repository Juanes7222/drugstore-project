// Mock @pharmacy/database before any imports that depend on it
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { PurchaseReceptionsService } from './purchase-receptions.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import { FiscalDocumentsService } from '@/modules/fiscal-dian/services/fiscal-documents.service';
import { MissingExpirationDateException } from '../exceptions/missing-expiration-date.exception';
import type { PurchaseReceptionConfirmationPayload } from '@/modules/sync/dto/purchase-sync-payloads';

// ── Mock objects ──────────────────────────────────────────────────────

function createTxMock() {
  return {
    $executeRaw: jest.fn(),
    supplier: { findUnique: jest.fn() },
    product: { findUnique: jest.fn() },
    purchaseOrder: { findUnique: jest.fn(), update: jest.fn() },
    purchaseOrderItem: { findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    purchaseReception: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    purchaseReceptionItem: { findFirst: jest.fn(), update: jest.fn() },
    lot: { findUnique: jest.fn(), updateMany: jest.fn() },
    inventoryMovement: { create: jest.fn() },
    fiscalDocument: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    invoiceTransmissionAttempt: { create: jest.fn() },
    receptionCreatedEvent: { create: jest.fn() },
    taxScheme: { findFirst: jest.fn() },
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
  resolveLotForSync: jest.fn(),
} as unknown as LotsService;

const mockFiscalDocumentsService = {
  createPendingDocumentForPurchaseReception: jest.fn(),
  enqueueGenerationJob: jest.fn(),
} as unknown as FiscalDocumentsService;

const mockSuppliersService = {
  resolveSupplierForSync: jest.fn(),
};

const mockTenantContext = {
  getSubscriptionId: jest.fn(() => 'test-subscription-id'),
  hasTenant: jest.fn(() => true),
};

const UUID = '00000000-0000-4000-8000-000000000001';

describe('PurchaseReceptionsService', () => {
  let service: PurchaseReceptionsService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore tx mocks by creating fresh ones
    Object.assign(mockTx, createTxMock());
    mockSuppliersService.resolveSupplierForSync.mockReset();
    service = new PurchaseReceptionsService(
      mockPrisma,
      mockLotsService,
      mockFiscalDocumentsService,
      mockSuppliersService as any,
      mockTenantContext as any,
    );
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

    describe('cursor mode', () => {
      const cursorTime = new Date('2026-07-05T00:00:00.000Z');
      const cursor = Buffer.from(
        JSON.stringify({
          lastUpdatedAt: cursorTime.toISOString(),
          lastId: 'r-prev',
        }),
      ).toString('base64');

      it('decodes the cursor into an OR keyset condition merged over base filters', async () => {
        mockPurchaseReception.findMany.mockResolvedValue([]);

        await service.findAll({
          page: 1,
          pageSize: 10,
          supplierId: 's1',
          cursor,
        });

        expect(mockPurchaseReception.findMany).toHaveBeenCalledWith({
          where: {
            supplierId: 's1',
            OR: [
              { createdAt: { lt: cursorTime } },
              { createdAt: cursorTime, id: { lt: 'r-prev' } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 11,
          include: { supplier: true, purchaseOrder: true, items: true },
        });
      });

      it('returns pageSize rows with hasMore true and a nextCursor built from the last row when more pages exist', async () => {
        const rows = Array.from({ length: 3 }, (_, i) => ({
          id: `r-${i}`,
          createdAt: new Date(Date.UTC(2026, 6, 10 - i)),
        }));
        mockPurchaseReception.findMany.mockResolvedValue(rows);

        const result = await service.findAll({ page: 1, pageSize: 2, cursor });

        expect(result.data).toHaveLength(2);
        expect(result.hasMore).toBe(true);
        const payload = JSON.parse(
          Buffer.from(result.nextCursor as string, 'base64').toString('utf8'),
        );
        expect(payload).toEqual({
          lastUpdatedAt: '2026-07-09T00:00:00.000Z',
          lastId: 'r-1',
        });
      });

      it('sets hasMore false and null nextCursor when the page exhausts the result set', async () => {
        const rows = Array.from({ length: 2 }, (_, i) => ({
          id: `r-${i}`,
          createdAt: new Date(Date.UTC(2026, 6, 10 - i)),
        }));
        mockPurchaseReception.findMany.mockResolvedValue(rows);

        const result = await service.findAll({ page: 1, pageSize: 2, cursor });

        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeNull();
      });
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
        items: [{
          productId: UUID,
          receivedQuantity: 10,
          realUnitCost: 5000,
          taxSchemeId: UUID,
          taxRate: 19,
        }],
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
        // FIX-010: the loop applies per-item increments and tracks them in
        // memory — the update must return the post-increment row.
        mockTx.purchaseOrderItem.update.mockResolvedValue({
          id: UUID,
          receivedQuantity: 10,
          pendingQuantity: 10,
        });
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

    it('throws MissingExpirationDateException when an item lacks expiration date', async () => {
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

      // FIX-018: the domain exception carries a stable error code.
      await expect(
        service.confirm('r1', 'user-1', 'ws-1'),
      ).rejects.toThrow(MissingExpirationDateException);
      await expect(
        service.confirm('r1', 'user-1', 'ws-1'),
      ).rejects.toMatchObject({
        errorCode: 'RECEPTION_ITEM_MISSING_EXPIRATION_DATE',
      });
    });
  });

  // ── annul ────────────────────────────────────────────────────────────

  describe('annul', () => {
    function configureAnnulMocks(overrides: Record<string, unknown> = {}) {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'CONFIRMED',
          items: [
            {
              id: 'item-1',
              productId: UUID,
              receivedQuantity: 10,
              lotId: 'lot-1',
              purchaseOrderItemId: 'poi-1',
              purchaseOrderItem: {
                id: 'poi-1',
                requestedQuantity: 20,
                receivedQuantity: 10,
                pendingQuantity: 0,
              },
            },
          ],
          purchaseOrder: {
            id: 'po-1',
            state: 'PARTIALLY_RECEIVED',
            items: [{ id: 'poi-1', requestedQuantity: 20, receivedQuantity: 10, pendingQuantity: 0 }],
          },
          ...overrides,
        });
        mockTx.lot.findUnique.mockResolvedValue({
          id: 'lot-1',
          currentStock: 10,
          version: 1,
          state: 'ACTIVE',
        });
        mockTx.lot.updateMany.mockResolvedValue({ count: 1 });
        mockTx.inventoryMovement.create.mockResolvedValue({ id: 'mov-1' });
        mockTx.purchaseOrderItem.update.mockResolvedValue({});
        mockTx.purchaseOrderItem.findMany.mockResolvedValue([{ receivedQuantity: 0 }]);
        mockTx.purchaseOrder.update.mockResolvedValue({});
        mockTx.fiscalDocument.findFirst.mockResolvedValue(null);
        mockTx.purchaseReception.update.mockResolvedValue({ id: 'r1', state: 'ANNULLED' });
        return cb(mockTx);
      });
    }

    it('annuls CONFIRMED reception, reverses stock, creates movement, reverts PO items', async () => {
      configureAnnulMocks();

      const result = await service.annul('r1', 'user-1');

      expect(result).toEqual({ id: 'r1', state: 'ANNULLED' });
      expect(mockTx.lot.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lot-1', version: 1 },
          data: expect.objectContaining({
            currentStock: 0,
            state: 'EXHAUSTED',
          }),
        }),
      );
      expect(mockTx.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            movementType: 'NEGATIVE_ADJUSTMENT',
            quantity: 10,
            purchaseReceptionId: 'r1',
            createdById: 'user-1',
          }),
        }),
      );
      expect(mockTx.purchaseOrderItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'poi-1' },
          data: {
            receivedQuantity: { decrement: 10 },
            pendingQuantity: { increment: 10 },
          },
        }),
      );
      expect(mockTx.purchaseReception.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'r1' },
          data: { state: 'ANNULLED' },
        }),
      );
    });

    it('throws PurchaseReceptionNotFoundException when reception does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(service.annul('missing', 'user-1')).rejects.toThrow(/Purchase reception.*not found/);
    });

    it('throws PurchaseReceptionNotConfirmedException when not in CONFIRMED state', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'DRAFT',
          items: [],
          purchaseOrder: null,
        });
        return cb(mockTx);
      });

      await expect(service.annul('r1', 'user-1')).rejects.toThrow(/not in CONFIRMED/);
    });

    it('skips stock reversal when item has no lotId', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'CONFIRMED',
          items: [
            {
              id: 'item-1',
              productId: UUID,
              receivedQuantity: 5,
              lotId: null,
              purchaseOrderItemId: null,
            },
          ],
          purchaseOrder: null,
        });
        mockTx.purchaseReception.update.mockResolvedValue({ id: 'r1', state: 'ANNULLED' });
        return cb(mockTx);
      });

      await service.annul('r1', 'user-1');

      expect(mockTx.lot.findUnique).not.toHaveBeenCalled();
      expect(mockTx.lot.updateMany).not.toHaveBeenCalled();
      expect(mockTx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('throws Error on concurrent stock modification (updateMany count = 0)', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'CONFIRMED',
          items: [
            {
              id: 'item-1',
              productId: UUID,
              receivedQuantity: 10,
              lotId: 'lot-1',
              purchaseOrderItemId: null,
            },
          ],
          purchaseOrder: null,
        });
        mockTx.lot.findUnique.mockResolvedValue({
          id: 'lot-1',
          currentStock: 10,
          version: 1,
          state: 'ACTIVE',
        });
        mockTx.lot.updateMany.mockResolvedValue({ count: 0 });
        return cb(mockTx);
      });

      await expect(service.annul('r1', 'user-1')).rejects.toThrow('Concurrent stock modification');
    });

    it('annuls associated fiscal document when one exists', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'CONFIRMED',
          items: [],
          purchaseOrder: null,
        });
        mockTx.fiscalDocument.findFirst.mockResolvedValue({ id: 'fd-1' });
        mockTx.fiscalDocument.update.mockResolvedValue({});
        mockTx.purchaseReception.update.mockResolvedValue({ id: 'r1', state: 'ANNULLED' });
        return cb(mockTx);
      });

      await service.annul('r1', 'user-1');

      expect(mockTx.fiscalDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'fd-1' },
          data: { fiscalState: 'ANNULLED' },
        }),
      );
    });

    it('skips fiscal document annulment when none exists', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'CONFIRMED',
          items: [],
          purchaseOrder: null,
        });
        mockTx.fiscalDocument.findFirst.mockResolvedValue(null);
        mockTx.purchaseReception.update.mockResolvedValue({ id: 'r1', state: 'ANNULLED' });
        return cb(mockTx);
      });

      await service.annul('r1', 'user-1');

      expect(mockTx.fiscalDocument.findFirst).toHaveBeenCalledWith({
        where: { purchaseReceptionId: 'r1', fiscalState: { notIn: ['ANNULLED'] } },
        select: { id: true },
      });
      expect(mockTx.fiscalDocument.update).not.toHaveBeenCalled();
    });

    it('reverts purchase order state to CONFIRMED when no items remain received', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'CONFIRMED',
          items: [
            {
              id: 'item-1',
              productId: UUID,
              receivedQuantity: 10,
              lotId: null,
              purchaseOrderItemId: null,
            },
          ],
          purchaseOrder: { id: 'po-1', state: 'PARTIALLY_RECEIVED', items: [] },
        });
        mockTx.purchaseOrderItem.findMany.mockResolvedValue([{ receivedQuantity: 0 }]);
        mockTx.purchaseOrder.update.mockResolvedValue({});
        mockTx.purchaseReception.update.mockResolvedValue({ id: 'r1', state: 'ANNULLED' });
        return cb(mockTx);
      });

      await service.annul('r1', 'user-1');

      expect(mockTx.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-1' },
          data: { state: 'CONFIRMED' },
        }),
      );
    });

    it('reverts purchase order state to PARTIALLY_RECEIVED when items still remain received', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'CONFIRMED',
          items: [
            {
              id: 'item-1',
              productId: UUID,
              receivedQuantity: 10,
              lotId: null,
              purchaseOrderItemId: null,
            },
          ],
          purchaseOrder: { id: 'po-1', state: 'FULLY_RECEIVED', items: [] },
        });
        mockTx.purchaseOrderItem.findMany.mockResolvedValue([{ receivedQuantity: 5 }]);
        mockTx.purchaseOrder.update.mockResolvedValue({});
        mockTx.purchaseReception.update.mockResolvedValue({ id: 'r1', state: 'ANNULLED' });
        return cb(mockTx);
      });

      await service.annul('r1', 'user-1');

      expect(mockTx.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'po-1' },
          data: { state: 'PARTIALLY_RECEIVED' },
        }),
      );
    });

    it('skips purchase order update when state is already correct', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findUnique.mockResolvedValue({
          id: 'r1',
          state: 'CONFIRMED',
          items: [
            {
              id: 'item-1',
              productId: UUID,
              receivedQuantity: 10,
              lotId: null,
              purchaseOrderItemId: null,
            },
          ],
          purchaseOrder: { id: 'po-1', state: 'PARTIALLY_RECEIVED', items: [] },
        });
        mockTx.purchaseOrderItem.findMany.mockResolvedValue([{ receivedQuantity: 5 }]);
        mockTx.purchaseReception.update.mockResolvedValue({ id: 'r1', state: 'ANNULLED' });
        return cb(mockTx);
      });

      await service.annul('r1', 'user-1');

      expect(mockTx.purchaseOrder.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // confirmReceptionFromSync
  // -------------------------------------------------------------------------
  describe('confirmReceptionFromSync', () => {
    const syncPayload: PurchaseReceptionConfirmationPayload = {
      receptionId: 'rec-sync-1',
      sequentialNumber: 200,
      supplierId: 'supplier-sync-1',
      supplier: {
        businessName: 'Sync Supplier',
        identificationType: 'NIT',
        identificationNumber: '900777777-7',
      },
      confirmedByUserId: 'user-1',
      createdById: 'user-1',
      confirmedAt: '2026-07-25T10:00:00.000Z',
      items: [
        {
          productId: 'prod-1',
          lotId: 'lot-sync-1',
          quantity: 25,
          unitCost: 5000,
          batchNumber: 'SYNC-BATCH-001',
          lot: {
            batchNumber: 'SYNC-BATCH-001',
            expirationDate: '2028-12-31T00:00:00.000Z',
            productId: 'prod-1',
            currentStock: 25,
          },
        },
      ],
    };

    const syncPayloadNoSupplierData: PurchaseReceptionConfirmationPayload = {
      ...syncPayload,
      supplier: undefined,
    };

    const syncPayloadItemNoLot: PurchaseReceptionConfirmationPayload = {
      ...syncPayload,
      items: [
        {
          productId: 'prod-1',
          quantity: 10,
          unitCost: 5000,
        },
      ],
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockTx.purchaseReception.findFirst.mockReset();
      mockTx.product.findUnique.mockReset();
      mockTx.purchaseReception.create.mockReset();
      mockTx.inventoryMovement.create.mockReset();
      mockLotsService.resolveLotForSync.mockReset();
      mockSuppliersService.resolveSupplierForSync.mockReset();
    });

    it('returns existing reception when same sequentialNumber + supplierId exists (idempotent)', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findFirst.mockResolvedValue({
          id: 'existing-rec',
          state: 'CONFIRMED',
        });
        return cb(mockTx);
      });

      const result = await service.confirmReceptionFromSync(syncPayload, 'user-1');

      expect(result).toEqual({ id: 'existing-rec', state: 'CONFIRMED' });
      expect(mockSuppliersService.resolveSupplierForSync).not.toHaveBeenCalled();
      expect(mockTx.purchaseReception.create).not.toHaveBeenCalled();
    });

    it('resolves supplier via resolver when supplier does not exist but payload has supplier data', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findFirst.mockResolvedValue(null);
        mockTx.product.findUnique.mockResolvedValue({ id: 'prod-1' });
        mockTx.taxScheme.findFirst.mockResolvedValue({ id: UUID, rate: new (require('@pharmacy/database').Prisma.Decimal)(19) });
        mockLotsService.resolveLotForSync.mockResolvedValue({
          id: 'lot-sync-1',
          currentStock: 25,
          version: 1,
          state: 'ACTIVE',
        });
        mockTx.inventoryMovement.create.mockResolvedValue({ id: 'mov-1' });
        mockTx.purchaseReception.create.mockResolvedValue({ id: 'new-rec' });
        return cb(mockTx);
      });

      await service.confirmReceptionFromSync(syncPayload, 'user-1');

      expect(mockSuppliersService.resolveSupplierForSync).toHaveBeenCalledWith(
        mockTx,
        'supplier-sync-1',
        syncPayload.supplier,
        'user-1',
      );
    });

    it('resolves each lot with lotId via lotsService and records inventory movement', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findFirst.mockResolvedValue(null);
        mockTx.product.findUnique.mockResolvedValue({ id: 'prod-1' });
        mockTx.taxScheme.findFirst.mockResolvedValue({ id: UUID, rate: new (require('@pharmacy/database').Prisma.Decimal)(19) });
        mockLotsService.resolveLotForSync.mockResolvedValue({
          id: 'lot-sync-1',
          currentStock: 25,
          version: 1,
          state: 'ACTIVE',
        });
        mockTx.inventoryMovement.create.mockResolvedValue({ id: 'mov-1' });
        mockTx.purchaseReception.create.mockResolvedValue({ id: 'new-rec' });
        return cb(mockTx);
      });

      await service.confirmReceptionFromSync(syncPayload, 'user-1');

      expect(mockLotsService.resolveLotForSync).toHaveBeenCalledWith(
        mockTx,
        'lot-sync-1',
        syncPayload.items[0].lot,
      );
      expect(mockTx.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            lotId: 'lot-sync-1',
            movementType: 'PURCHASE_RECEIPT',
            quantity: 25,
            purchaseReceptionId: expect.any(String),
          }),
        }),
      );
    });

    it('skips lot resolution and movement when item has no lotId', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findFirst.mockResolvedValue(null);
        mockTx.product.findUnique.mockResolvedValue({ id: 'prod-1' });
        mockTx.taxScheme.findFirst.mockResolvedValue({ id: UUID, rate: new (require('@pharmacy/database').Prisma.Decimal)(19) });
        mockTx.purchaseReception.create.mockResolvedValue({ id: 'new-rec' });
        return cb(mockTx);
      });

      await service.confirmReceptionFromSync(syncPayloadItemNoLot, 'user-1');

      expect(mockLotsService.resolveLotForSync).not.toHaveBeenCalled();
      expect(mockTx.inventoryMovement.create).not.toHaveBeenCalled();
    });

    it('falls back to the documented nil sentinel tax scheme when no default exists', async () => {
      // FIX-022: without an active default tax scheme the sync path writes
      // '00000000-0000-0000-0000-000000000000' so item rows never carry a
      // null taxSchemeId (the column is NOT NULL in the schema).
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findFirst.mockResolvedValue(null);
        mockTx.product.findUnique.mockResolvedValue({ id: 'prod-1' });
        mockTx.taxScheme.findFirst.mockResolvedValue(null);
        mockLotsService.resolveLotForSync.mockResolvedValue({
          id: 'lot-sync-1',
          currentStock: 25,
          version: 1,
          state: 'ACTIVE',
        });
        mockTx.inventoryMovement.create.mockResolvedValue({ id: 'mov-1' });
        mockTx.purchaseReception.create.mockResolvedValue({ id: 'new-rec' });
        return cb(mockTx);
      });

      await service.confirmReceptionFromSync(syncPayload, 'user-1');

      expect(mockTx.purchaseReception.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            items: {
              create: [
                expect.objectContaining({
                  taxSchemeId: '00000000-0000-0000-0000-000000000000',
                }),
              ],
            },
          }),
        }),
      );
    });

    it('throws ProductNotFoundException when a product does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.purchaseReception.findFirst.mockResolvedValue(null);
        mockTx.product.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(
        service.confirmReceptionFromSync(syncPayload, 'user-1'),
      ).rejects.toThrow(/Product.*not found/);
    });
  });
});
