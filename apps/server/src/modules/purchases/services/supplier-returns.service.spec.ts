// Mock @pharmacy/database before any imports that depend on it
import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { SupplierReturnsService } from './supplier-returns.service';
import { hashAdvisoryKey } from '@/common/utils/advisory-lock';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';
import type { SupplierReturnConfirmationPayload } from '@/modules/sync/dto/purchase-sync-payloads';

// ── Mock objects ──────────────────────────────────────────────────────

function createTxMock() {
  return {
    // FIX-006/007: sequential-number allocation and the sync confirm path
    // run under a PostgreSQL advisory lock (pg_advisory_xact_lock).
    $executeRaw: jest.fn(),
    supplier: { findUnique: jest.fn() },
    purchaseReception: { findUnique: jest.fn() },
    purchaseReceptionItem: { findFirst: jest.fn() },
    lot: { findUnique: jest.fn() },
    supplierReturn: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  };
}

const mockTx = createTxMock();

const mockSupplierReturn = {
  findMany: jest.fn(),
  findUnique: jest.fn(),
  count: jest.fn(),
  update: jest.fn(),
};

const mockProduct = {
  findMany: jest.fn(),
};

const mockLot = {
  findMany: jest.fn(),
};

const mockPrisma = {
  supplierReturn: mockSupplierReturn,
  product: mockProduct,
  lot: mockLot,
  $transaction: jest.fn(),
} as unknown as PrismaService;

const mockLotsService = {
  consumeStockForSupplierReturn: jest.fn(),
  resolveLotForSync: jest.fn(),
} as unknown as LotsService;

const mockSuppliersService = {
  resolveSupplierForSync: jest.fn(),
};

const mockTenantContext = {
  getSubscriptionId: jest.fn(() => 'test-subscription-id'),
  hasTenant: jest.fn(() => true),
};

const UUID = '00000000-0000-4000-8000-000000000001';

describe('SupplierReturnsService', () => {
  let service: SupplierReturnsService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockTx, createTxMock());
    mockSuppliersService.resolveSupplierForSync.mockReset();
    service = new SupplierReturnsService(mockPrisma, mockLotsService, mockSuppliersService as any, mockTenantContext as any);
  });

  // ── findAll ─────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns paginated supplier returns with total count', async () => {
      const mockData = [{ id: 'sr1', supplier: { id: 's1' }, items: [] }];
      mockPrisma.$transaction.mockImplementation(async (promises: any) => Promise.all(promises));
      mockSupplierReturn.findMany.mockResolvedValue(mockData);
      mockSupplierReturn.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, pageSize: 20 });

      expect(result).toEqual({ data: mockData, total: 1, page: 1, pageSize: 20 });
    });

    it('filters by supplierId when provided', async () => {
      mockPrisma.$transaction.mockImplementation(async (promises: any) => Promise.all(promises));
      mockSupplierReturn.findMany.mockResolvedValue([]);
      mockSupplierReturn.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, supplierId: 's1' });

      expect(mockSupplierReturn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { supplierId: 's1' } }),
      );
    });

    it('filters by state when provided', async () => {
      mockPrisma.$transaction.mockImplementation(async (promises: any) => Promise.all(promises));
      mockSupplierReturn.findMany.mockResolvedValue([]);
      mockSupplierReturn.count.mockResolvedValue(0);

      await service.findAll({ page: 1, pageSize: 10, state: 'DRAFT' });

      expect(mockSupplierReturn.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { state: 'DRAFT' } }),
      );
    });

    describe('cursor mode', () => {
      const cursorTime = new Date('2026-05-01T00:00:00.000Z');
      const cursor = Buffer.from(
        JSON.stringify({
          lastUpdatedAt: cursorTime.toISOString(),
          lastId: 'sr-prev',
        }),
      ).toString('base64');

      it('decodes the cursor into an OR keyset condition merged over base filters', async () => {
        mockSupplierReturn.findMany.mockResolvedValue([]);

        await service.findAll({
          page: 1,
          pageSize: 10,
          supplierId: 's1',
          cursor,
        });

        expect(mockSupplierReturn.findMany).toHaveBeenCalledWith({
          where: {
            supplierId: 's1',
            OR: [
              { createdAt: { lt: cursorTime } },
              { createdAt: cursorTime, id: { lt: 'sr-prev' } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 11,
          include: { supplier: true, items: true },
        });
      });

      it('returns pageSize rows with hasMore true and a nextCursor built from the last row when more pages exist', async () => {
        const rows = Array.from({ length: 3 }, (_, i) => ({
          id: `sr-${i}`,
          createdAt: new Date(Date.UTC(2026, 4, 10 - i)),
        }));
        mockSupplierReturn.findMany.mockResolvedValue(rows);

        const result = await service.findAll({ page: 1, pageSize: 2, cursor });

        expect(result.data).toHaveLength(2);
        expect(result.hasMore).toBe(true);
        const payload = JSON.parse(
          Buffer.from(result.nextCursor as string, 'base64').toString('utf8'),
        );
        expect(payload).toEqual({
          lastUpdatedAt: '2026-05-09T00:00:00.000Z',
          lastId: 'sr-1',
        });
      });

      it('sets hasMore false and null nextCursor when the page exhausts the result set', async () => {
        const rows = Array.from({ length: 2 }, (_, i) => ({
          id: `sr-${i}`,
          createdAt: new Date(Date.UTC(2026, 4, 10 - i)),
        }));
        mockSupplierReturn.findMany.mockResolvedValue(rows);

        const result = await service.findAll({ page: 1, pageSize: 2, cursor });

        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeNull();
      });
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────

  describe('findOne', () => {
    it('returns the supplier return with enriched product and lot data', async () => {
      const mockReturn = {
        id: 'sr1',
        items: [
          { productId: UUID, lotId: UUID, quantity: 5 },
        ],
        supplier: { id: UUID },
        purchaseReception: { id: UUID },
      };
      mockSupplierReturn.findUnique.mockResolvedValue(mockReturn);
      mockProduct.findMany.mockResolvedValue([{ id: UUID, name: 'Product A' }]);
      mockLot.findMany.mockResolvedValue([{ id: UUID, batchNumber: 'LOT-001' }]);

      const result = await service.findOne('sr1');

      expect(result.id).toBe('sr1');
      expect(result.items[0].product).toEqual({ id: UUID, name: 'Product A' });
      expect(result.items[0].lot).toEqual({ id: UUID, batchNumber: 'LOT-001' });
    });

    it('throws SupplierReturnNotFoundException when not found', async () => {
      mockSupplierReturn.findUnique.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toThrow(/Supplier return.*not found/);
    });
  });

  // ── create ───────────────────────────────────────────────────────────

  describe('create', () => {
    const validDto = {
      supplierId: UUID,
      purchaseReceptionId: UUID,
      reason: 'Damaged goods',
      items: [
        { productId: UUID, lotId: UUID, quantity: 5 },
      ],
    };

    function configureSuccessMocks() {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID, name: 'Supplier' });
        mockTx.purchaseReception.findUnique.mockResolvedValue({ id: UUID });
        mockTx.lot.findUnique.mockResolvedValue({ id: UUID, currentStock: 100 });
        mockTx.purchaseReceptionItem.findFirst.mockResolvedValue({ realUnitCost: new (require('@pharmacy/database').Prisma.Decimal)(5000) });
        mockTx.supplierReturn.findFirst.mockResolvedValue(null);
        mockTx.supplierReturn.create.mockResolvedValue({ id: 'new-return' });
        return cb(mockTx);
      });
    }

    it('creates a DRAFT supplier return with items', async () => {
      configureSuccessMocks();

      const result = await service.create(validDto, 'user-1');

      expect(result).toEqual({ id: 'new-return' });
      expect(mockTx.supplierReturn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            supplierId: UUID,
            reason: 'Damaged goods',
            createdById: 'user-1',
          }),
        }),
      );
      // FIX-006: sequential-number allocation runs under a per-tenant advisory
      // lock so concurrent creates cannot both read the same MAX.
      expect(mockTx.$executeRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('pg_advisory_xact_lock')]),
        hashAdvisoryKey('test-subscription-id:supplier-return:seq'),
      );
    });

    it('throws SupplierNotFoundException when supplier does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(/Supplier.*not found/);
    });

    it('throws PurchaseReceptionNotFoundException when reception does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID });
        mockTx.purchaseReception.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(/Purchase reception.*not found/);
    });

    it('throws LotNotFoundException when lot does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID });
        mockTx.purchaseReception.findUnique.mockResolvedValue({ id: UUID });
        mockTx.lot.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(/Lot.*not found/);
    });

    it('throws SupplierReturnLotCostUnavailableException when unit cost is missing', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID });
        mockTx.purchaseReception.findUnique.mockResolvedValue({ id: UUID });
        mockTx.lot.findUnique.mockResolvedValue({ id: UUID, currentStock: 100 });
        mockTx.purchaseReceptionItem.findFirst.mockResolvedValue(null); // no reception item with this lot
        return cb(mockTx);
      });

      await expect(service.create(validDto, 'user-1')).rejects.toThrow(/Cannot determine unit cost/);
    });

    it('creates without purchaseReceptionId when not provided', async () => {
      const dtoWithoutReception = { supplierId: UUID, reason: 'Damaged', items: validDto.items };
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplier.findUnique.mockResolvedValue({ id: UUID });
        mockTx.lot.findUnique.mockResolvedValue({ id: UUID, currentStock: 100 });
        mockTx.purchaseReceptionItem.findFirst.mockResolvedValue({ realUnitCost: new (require('@pharmacy/database').Prisma.Decimal)(5000) });
        mockTx.supplierReturn.findFirst.mockResolvedValue(null);
        mockTx.supplierReturn.create.mockResolvedValue({ id: 'new-return' });
        return cb(mockTx);
      });

      const result = await service.create(dtoWithoutReception, 'user-1');

      expect(result).toEqual({ id: 'new-return' });
      expect(mockTx.purchaseReception.findUnique).not.toHaveBeenCalled();
    });
  });

  // ── confirm ──────────────────────────────────────────────────────────

  describe('confirm', () => {
    function configureConfirmMocks(overrides: Record<string, unknown> = {}) {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplierReturn.findUnique.mockResolvedValue({
          id: 'sr1',
          state: 'DRAFT',
          items: [
            { id: 'item-1', lotId: UUID, quantity: 5, productId: UUID },
          ],
          ...overrides,
        });
        mockLotsService.consumeStockForSupplierReturn.mockResolvedValue(undefined);
        mockTx.supplierReturn.update.mockResolvedValue({ id: 'sr1', state: 'CONFIRMED' });
        return cb(mockTx);
      });
    }

    it('confirms a DRAFT return and consumes stock', async () => {
      configureConfirmMocks();

      const result = await service.confirm('sr1', 'user-1');

      expect(result.state).toBe('CONFIRMED');
      expect(mockLotsService.consumeStockForSupplierReturn).toHaveBeenCalledWith(
        expect.objectContaining({ lotId: UUID, quantity: 5, tx: mockTx }),
      );
    });

    it('throws SupplierReturnNotFoundException when return does not exist', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplierReturn.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(service.confirm('missing', 'user-1')).rejects.toThrow(/Supplier return.*not found/);
    });

    it('throws SupplierReturnNotDraftException when not in DRAFT state', async () => {
      configureConfirmMocks({ state: 'CONFIRMED' });

      await expect(service.confirm('sr1', 'user-1')).rejects.toThrow(/not in DRAFT state/);
    });
  });

  // ── approve ──────────────────────────────────────────────────────────

  describe('approve', () => {
    it('approves a CONFIRMED return', async () => {
      mockSupplierReturn.findUnique.mockResolvedValue({ id: 'sr1', state: 'CONFIRMED' });
      mockSupplierReturn.update.mockResolvedValue({ id: 'sr1', state: 'APPROVED' });

      const result = await service.approve('sr1');

      expect(result.state).toBe('APPROVED');
      expect(mockSupplierReturn.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { state: 'APPROVED' } }),
      );
    });

    it('throws SupplierReturnNotFoundException when not found', async () => {
      mockSupplierReturn.findUnique.mockResolvedValue(null);

      await expect(service.approve('missing')).rejects.toThrow(/Supplier return.*not found/);
    });

    it('throws SupplierReturnNotDraftException when not in CONFIRMED state', async () => {
      mockSupplierReturn.findUnique.mockResolvedValue({ id: 'sr1', state: 'DRAFT' });

      await expect(service.approve('sr1')).rejects.toThrow(/not in CONFIRMED state/);
    });
  });

  // ── annul ────────────────────────────────────────────────────────────

  describe('annul', () => {
    it('annuls a DRAFT return', async () => {
      mockSupplierReturn.findUnique.mockResolvedValue({ id: 'sr1', state: 'DRAFT' });
      mockSupplierReturn.update.mockResolvedValue({ id: 'sr1', state: 'ANNULLED' });

      const result = await service.annul('sr1');

      expect(result.state).toBe('ANNULLED');
    });

    it('throws SupplierReturnNotFoundException when not found', async () => {
      mockSupplierReturn.findUnique.mockResolvedValue(null);

      await expect(service.annul('missing')).rejects.toThrow(/Supplier return.*not found/);
    });

    it('throws SupplierReturnCannotBeAnnulledException when not in DRAFT', async () => {
      mockSupplierReturn.findUnique.mockResolvedValue({ id: 'sr1', state: 'CONFIRMED' });

      await expect(service.annul('sr1')).rejects.toThrow(/cannot be annulled/);
    });
  });

  // -------------------------------------------------------------------------
  // confirmReturnFromSync
  // -------------------------------------------------------------------------
  describe('confirmReturnFromSync', () => {
    const syncPayload: SupplierReturnConfirmationPayload = {
      returnId: 'sr-sync-1',
      sequentialNumber: 300,
      supplierId: 'supplier-sync-1',
      supplier: {
        businessName: 'Sync Supplier',
        identificationType: 'NIT',
        identificationNumber: '900666666-6',
      },
      reason: 'Damaged in transit',
      createdByUserId: 'user-1',
      confirmedAt: '2026-07-25T10:00:00.000Z',
      items: [
        {
          productId: 'prod-1',
          lotId: 'lot-sync-1',
          quantity: 5,
          unitCost: 5000,
          lot: {
            batchNumber: 'SYNC-BATCH-001',
            expirationDate: '2028-12-31T00:00:00.000Z',
            productId: 'prod-1',
            currentStock: 5,
          },
        },
      ],
    };

    const syncPayloadNoSupplierData: SupplierReturnConfirmationPayload = {
      ...syncPayload,
      supplier: undefined,
    };

    beforeEach(() => {
      jest.clearAllMocks();
      mockTx.supplierReturn.findFirst.mockReset();
      mockTx.purchaseReception.findUnique.mockReset();
      mockTx.supplierReturn.create.mockReset();
      mockLotsService.resolveLotForSync.mockReset();
      mockSuppliersService.resolveSupplierForSync.mockReset();
    });

    it('returns existing return when same sequentialNumber + supplierId exists (idempotent)', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplierReturn.findFirst.mockResolvedValue({
          id: 'existing-sr',
          state: 'CONFIRMED',
        });
        return cb(mockTx);
      });

      const result = await service.confirmReturnFromSync(syncPayload, 'user-1');

      expect(result).toEqual({ id: 'existing-sr', state: 'CONFIRMED' });
      expect(mockSuppliersService.resolveSupplierForSync).not.toHaveBeenCalled();
      expect(mockTx.supplierReturn.create).not.toHaveBeenCalled();
      // FIX-007: the lock is acquired even on the idempotent path, so
      // duplicate BullMQ deliveries serialize instead of double-creating.
      expect(mockTx.$executeRaw).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining('pg_advisory_xact_lock')]),
        hashAdvisoryKey('test-subscription-id:supplier-return:sr-sync-1'),
      );
    });

    it('resolves supplier via resolver when supplier does not exist but payload has supplier data', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplierReturn.findFirst.mockResolvedValue(null);
        mockLotsService.resolveLotForSync.mockResolvedValue({
          id: 'lot-sync-1',
          currentStock: 5,
          version: 1,
          state: 'ACTIVE',
        });
        mockTx.supplierReturn.create.mockResolvedValue({ id: 'new-sr' });
        return cb(mockTx);
      });

      await service.confirmReturnFromSync(syncPayload, 'user-1');

      expect(mockSuppliersService.resolveSupplierForSync).toHaveBeenCalledWith(
        mockTx,
        'supplier-sync-1',
        syncPayload.supplier,
        'user-1',
      );
    });

    it('resolves each item lot via lotsService', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplierReturn.findFirst.mockResolvedValue(null);
        mockLotsService.resolveLotForSync.mockResolvedValue({
          id: 'lot-sync-1',
          currentStock: 5,
          version: 1,
          state: 'ACTIVE',
        });
        mockTx.supplierReturn.create.mockResolvedValue({ id: 'new-sr' });
        return cb(mockTx);
      });

      await service.confirmReturnFromSync(syncPayload, 'user-1');

      expect(mockLotsService.resolveLotForSync).toHaveBeenCalledWith(
        mockTx,
        'lot-sync-1',
        syncPayload.items[0].lot,
      );
    });

    it('creates a CONFIRMED return with items and supplier', async () => {
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplierReturn.findFirst.mockResolvedValue(null);
        mockSuppliersService.resolveSupplierForSync.mockResolvedValue({ id: 'supplier-sync-1' });
        mockLotsService.resolveLotForSync.mockResolvedValue({
          id: 'lot-sync-1',
          currentStock: 5,
          version: 1,
          state: 'ACTIVE',
        });
        mockTx.supplierReturn.create.mockResolvedValue({ id: 'new-sr' });
        return cb(mockTx);
      });

      const result = await service.confirmReturnFromSync(syncPayload, 'user-1');

      expect(result.id).toBe('new-sr');
      expect(mockTx.supplierReturn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            sequentialNumber: 300,
            supplierId: 'supplier-sync-1',
            reason: 'Damaged in transit',
            state: 'CONFIRMED',
          }),
        }),
      );
    });

    it('throws PurchaseReceptionNotFoundException when referenced reception does not exist', async () => {
      const payloadWithReception = {
        ...syncPayload,
        purchaseReceptionId: 'missing-rec',
      };
      mockPrisma.$transaction.mockImplementation(async (cb: Function) => {
        mockTx.supplierReturn.findFirst.mockResolvedValue(null);
        mockTx.purchaseReception.findUnique.mockResolvedValue(null);
        return cb(mockTx);
      });

      await expect(
        service.confirmReturnFromSync(payloadWithReception, 'user-1'),
      ).rejects.toThrow(/Purchase reception.*not found/);
    });
  });
});
