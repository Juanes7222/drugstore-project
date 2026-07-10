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
    toNumber() { return Number(this.value); }
  }
  return {
    PrismaClient: MockPrismaClient,
    Prisma: { Decimal: MockDecimal },
    PurchaseReturnState: { DRAFT: 'DRAFT', CONFIRMED: 'CONFIRMED', APPROVED: 'APPROVED', ANNULLED: 'ANNULLED' },
  };
});

import { SupplierReturnsService } from './supplier-returns.service';
import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import { LotsService } from '@/modules/inventory-lots/services/lots.service';

// ── Mock objects ──────────────────────────────────────────────────────

function createTxMock() {
  return {
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
} as unknown as LotsService;

const UUID = '00000000-0000-4000-8000-000000000001';

describe('SupplierReturnsService', () => {
  let service: SupplierReturnsService;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockTx, createTxMock());
    service = new SupplierReturnsService(mockPrisma, mockLotsService);
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
});
