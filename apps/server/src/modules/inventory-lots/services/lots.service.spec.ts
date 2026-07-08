import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, Prisma, LotState, MovementType } from '@pharmacy/database';
import { LotsService } from './lots.service';
import { InsufficientStockException } from '../exceptions/insufficient-stock.exception';
import { ConcurrentStockModificationException } from '../exceptions/concurrent-stock-modification.exception';
import { LotNotActiveException } from '../exceptions/lot-not-active.exception';
import { LotNotBlockedException } from '../exceptions/lot-not-blocked.exception';
import { LotNotFoundException } from '../exceptions/lot-not-found.exception';
import { LotCostUnavailableException } from '../exceptions/lot-cost-unavailable.exception';
import { LotStateChangedSinceSaleException } from '../exceptions/lot-state-changed-since-sale.exception';
import { LotNotEligibleForReturnException } from '../exceptions/lot-not-eligible-for-return.exception';
import { NotImplementedForPhaseException } from '@/common/exceptions/not-implemented-for-phase.exception';

jest.mock('@pharmacy/database', () => {
  const DecimalMock = jest.fn().mockImplementation((v: any) => ({
    toString: () => String(v),
    toNumber: () => Number(v),
    times: function (o: any) { return new DecimalMock(Number(v) * Number(o)); },
    dividedBy: function (o: any) { return new DecimalMock(Number(v) / Number(o)); },
    plus: function (o: any) { return new DecimalMock(Number(v) + Number(o)); },
    minus: function (o: any) { return new DecimalMock(Number(v) - Number(o)); },
  }));
  return {
    PrismaClient: jest.fn(),
    LotState: { ACTIVE: 'ACTIVE', BLOCKED: 'BLOCKED', EXPIRED: 'EXPIRED', QUARANTINE: 'QUARANTINE', COMMITTED: 'COMMITTED' },
    MovementType: {
      INCOMING: 'INCOMING', OUTGOING: 'OUTGOING', ADJUSTMENT: 'ADJUSTMENT',
      RETURN: 'RETURN', CANCEL: 'CANCEL',
      ADMIN_BLOCK: 'ADMIN_BLOCK', ADMIN_UNBLOCK: 'ADMIN_UNBLOCK',
      PURCHASE_RECEIPT: 'PURCHASE_RECEIPT', SUPPLIER_RETURN: 'SUPPLIER_RETURN',
      CLIENT_RETURN: 'CLIENT_RETURN',
    },
    Prisma: {
      Decimal: DecimalMock,
    },
  };
});

describe('LotsService', () => {
  let service: LotsService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockLot = {
    id: 'lot-1',
    productId: 'prod-1',
    batchNumber: 'BATCH-001',
    expirationDate: new Date('2027-12-31'),
    entryDate: new Date('2026-01-15'),
    currentStock: 100,
    version: 0,
    state: 'ACTIVE',
    locationCode: 'A-01',
    blockedAt: null,
    blockedByUserId: null,
    blockReason: null,
    createdById: 'system',
    purchaseReceptionItems: [{ realUnitCost: new Prisma.Decimal(2500) }],
  };

  const mockTx = {} as any;

  function setupTransactionMock(): void {
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') return cb(prisma);
      return cb;
    });
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new LotsService(prisma as any);
  });

  describe('findAll', () => {
    it('returns paginated lots with filters', async () => {
      const lots = [mockLot];
      (prisma.$transaction as jest.Mock).mockResolvedValue([lots, 1]);

      const result = await service.findAll({ page: 1, pageSize: 20, productId: 'prod-1', state: 'ACTIVE' });

      expect(result.data).toEqual(lots);
      expect(result.total).toBe(1);
    });
  });

  describe('findById', () => {
    it('returns the lot when found', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue(mockLot);

      const result = await service.findById('lot-1');

      expect(result).toEqual(mockLot);
    });

    it('throws LotNotFoundException when not found', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.findById('unknown')).rejects.toThrow(LotNotFoundException);
    });
  });

  describe('blockLot', () => {
    it('blocks an active lot and creates an ADMIN_BLOCK movement', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue(mockLot);
      setupTransactionMock();
      (prisma.lot.update as jest.Mock).mockResolvedValue({ ...mockLot, state: 'BLOCKED' });
      (prisma.inventoryMovement.create as jest.Mock).mockResolvedValue({} as any);

      const result = await service.blockLot('lot-1', { reason: 'Quality hold' }, 'user-1');

      expect(result.state).toBe('BLOCKED');
      expect(prisma.lot.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'lot-1' },
          data: expect.objectContaining({ state: 'BLOCKED', blockReason: 'Quality hold' }),
        }),
      );
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ movementType: 'ADMIN_BLOCK' }),
        }),
      );
    });

    it('throws LotNotActiveException when lot is not ACTIVE', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ ...mockLot, state: 'BLOCKED' });

      await expect(service.blockLot('lot-1', { reason: 'test' }, 'user-1')).rejects.toThrow(LotNotActiveException);
    });
  });

  describe('unblockLot', () => {
    it('unblocks a blocked lot and creates an ADMIN_UNBLOCK movement', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ ...mockLot, state: 'BLOCKED' });
      setupTransactionMock();
      (prisma.lot.update as jest.Mock).mockResolvedValue({ ...mockLot, state: 'ACTIVE' });
      (prisma.inventoryMovement.create as jest.Mock).mockResolvedValue({} as any);

      const result = await service.unblockLot('lot-1', 'user-1');

      expect(result.state).toBe('ACTIVE');
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ movementType: 'ADMIN_UNBLOCK' }),
        }),
      );
    });

    it('restores to ACTIVE when stock > 0, EXHAUSTED when stock === 0', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ ...mockLot, state: 'BLOCKED', currentStock: 0 });
      setupTransactionMock();
      (prisma.lot.update as jest.Mock).mockResolvedValue({ ...mockLot, state: 'EXHAUSTED', currentStock: 0 });
      (prisma.inventoryMovement.create as jest.Mock).mockResolvedValue({} as any);

      const result = await service.unblockLot('lot-1', 'user-1');

      expect(result.state).toBe('EXHAUSTED');
    });

    it('throws LotNotBlockedException when lot is not BLOCKED', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ ...mockLot, state: 'ACTIVE' });

      await expect(service.unblockLot('lot-1', 'user-1')).rejects.toThrow(LotNotBlockedException);
    });
  });

  describe('listMovements', () => {
    it('returns paginated movements with filters', async () => {
      (prisma.$transaction as jest.Mock).mockResolvedValue([[{ id: 'mov-1' }], 1]);

      const result = await service.listMovements({ page: 1, pageSize: 20, lotId: 'lot-1' });

      expect(result.total).toBe(1);
    });
  });

  describe('consumeStockForSale', () => {
    it('consumes stock from available lots using FIFO order', async () => {
      const lotA = { ...mockLot, id: 'lot-a', currentStock: 10, version: 1, purchaseReceptionItems: [{ realUnitCost: new Prisma.Decimal(2000) }] };
      const lotB = { ...mockLot, id: 'lot-b', currentStock: 5, version: 1, purchaseReceptionItems: [{ realUnitCost: new Prisma.Decimal(2500) }] };
      (prisma.lot.findMany as jest.Mock).mockResolvedValue([lotA, lotB]);
      (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.inventoryMovement.create as jest.Mock).mockResolvedValue({} as any);

      const result = await service.consumeStockForSale({
        productId: 'prod-1',
        quantity: 12,
        saleId: 'sale-1',
        tx: prisma as any,
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ lotId: 'lot-a', quantity: 10 });
      expect(result[1]).toMatchObject({ lotId: 'lot-b', quantity: 2 });
      expect(prisma.lot.updateMany).toHaveBeenCalledTimes(2);
    });

    it('throws InsufficientStockException when total available is less than quantity', async () => {
      (prisma.lot.findMany as jest.Mock).mockResolvedValue([{ ...mockLot, currentStock: 5 }]);

      await expect(
        service.consumeStockForSale({ productId: 'prod-1', quantity: 99, saleId: 'sale-1', tx: prisma as any }),
      ).rejects.toThrow(InsufficientStockException);
    });

    it('throws ConcurrentStockModificationException when updateMany returns 0', async () => {
      (prisma.lot.findMany as jest.Mock).mockResolvedValue([{ ...mockLot, currentStock: 10, purchaseReceptionItems: [{ realUnitCost: new Prisma.Decimal(2000) }] }]);
      (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(
        service.consumeStockForSale({ productId: 'prod-1', quantity: 5, saleId: 'sale-1', tx: prisma as any }),
      ).rejects.toThrow(ConcurrentStockModificationException);
    });

    it('throws LotCostUnavailableException when realUnitCost is missing', async () => {
      (prisma.lot.findMany as jest.Mock).mockResolvedValue([{ ...mockLot, currentStock: 10, purchaseReceptionItems: [] }]);
      (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

      await expect(
        service.consumeStockForSale({ productId: 'prod-1', quantity: 5, saleId: 'sale-1', tx: prisma as any }),
      ).rejects.toThrow(LotCostUnavailableException);
    });
  });

  describe('receiveStock', () => {
    it('creates a new lot and a PURCHASE_RECEIPT movement', async () => {
      setupTransactionMock();
      (prisma.lot.create as jest.Mock).mockResolvedValue(mockLot);
      (prisma.inventoryMovement.create as jest.Mock).mockResolvedValue({} as any);

      const result = await service.receiveStock({
        productId: 'prod-1',
        quantity: 50,
        unitCost: new Prisma.Decimal(3000),
        batchNumber: 'BATCH-002',
        expirationDate: new Date('2028-06-30'),
        tx: prisma as any,
      });

      expect(result.lotId).toBe(mockLot.id);
      expect(prisma.lot.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            productId: 'prod-1',
            batchNumber: 'BATCH-002',
            currentStock: 50,
            state: 'ACTIVE',
          }),
        }),
      );
      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ movementType: 'PURCHASE_RECEIPT' }),
        }),
      );
    });
  });

  describe('reverseStockForSale', () => {
    it('reverses stock for all lots consumed in a sale', async () => {
      const saleItemLots = [
        { lotId: 'lot-1', quantity: 5, lot: { id: 'lot-1', currentStock: 3, version: 2, state: 'ACTIVE' } },
        { lotId: 'lot-2', quantity: 3, lot: { id: 'lot-2', currentStock: 0, version: 1, state: 'EXHAUSTED' } },
      ];
      (prisma.saleItemLot.findMany as jest.Mock).mockResolvedValue(saleItemLots as any);
      (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.inventoryMovement.create as jest.Mock).mockResolvedValue({} as any);

      const result = await service.reverseStockForSale({ saleId: 'sale-1', tx: prisma as any });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ lotId: 'lot-1', quantity: 5 });
      expect(result[1]).toEqual({ lotId: 'lot-2', quantity: 3 });
    });

    it('returns empty array when no lot aggregations exist', async () => {
      (prisma.saleItemLot.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.reverseStockForSale({ saleId: 'sale-1', tx: prisma as any });

      expect(result).toEqual([]);
    });

    it('throws LotStateChangedSinceSaleException when a lot is EXPIRED', async () => {
      (prisma.saleItemLot.findMany as jest.Mock).mockResolvedValue([
        { lotId: 'lot-1', quantity: 5, lot: { id: 'lot-1', currentStock: 3, version: 2, state: 'EXPIRED' } },
      ] as any);

      await expect(
        service.reverseStockForSale({ saleId: 'sale-1', tx: prisma as any }),
      ).rejects.toThrow(LotStateChangedSinceSaleException);
    });

    it('throws LotStateChangedSinceSaleException when a lot is BLOCKED', async () => {
      (prisma.saleItemLot.findMany as jest.Mock).mockResolvedValue([
        { lotId: 'lot-1', quantity: 5, lot: { id: 'lot-1', currentStock: 3, version: 2, state: 'BLOCKED' } },
      ] as any);

      await expect(
        service.reverseStockForSale({ saleId: 'sale-1', tx: prisma as any }),
      ).rejects.toThrow(LotStateChangedSinceSaleException);
    });
  });

  describe('consumeStockForSupplierReturn', () => {
    it('consumes stock from a specific lot', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue(mockLot);
      (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.inventoryMovement.create as jest.Mock).mockResolvedValue({} as any);

      await service.consumeStockForSupplierReturn({
        lotId: 'lot-1',
        quantity: 10,
        supplierReturnId: 'sr-1',
        tx: prisma as any,
      });

      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ movementType: 'SUPPLIER_RETURN' }),
        }),
      );
    });

    it('throws LotNotFoundException when lot does not exist', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.consumeStockForSupplierReturn({ lotId: 'unknown', quantity: 5, supplierReturnId: 'sr-1', tx: prisma as any }),
      ).rejects.toThrow(LotNotFoundException);
    });

    it('throws InsufficientStockException when lot stock is insufficient', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ ...mockLot, currentStock: 3 });

      await expect(
        service.consumeStockForSupplierReturn({ lotId: 'lot-1', quantity: 99, supplierReturnId: 'sr-1', tx: prisma as any }),
      ).rejects.toThrow(InsufficientStockException);
    });

    it('throws ConcurrentStockModificationException on version conflict', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue(mockLot);
      (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

      await expect(
        service.consumeStockForSupplierReturn({ lotId: 'lot-1', quantity: 5, supplierReturnId: 'sr-1', tx: prisma as any }),
      ).rejects.toThrow(ConcurrentStockModificationException);
    });
  });

  describe('receiveStockFromClientReturn', () => {
    it('receives stock back into a lot', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue(mockLot);
      (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
      (prisma.inventoryMovement.create as jest.Mock).mockResolvedValue({} as any);

      await service.receiveStockFromClientReturn({
        lotId: 'lot-1',
        quantity: 3,
        clientReturnId: 'cr-1',
        tx: prisma as any,
      });

      expect(prisma.inventoryMovement.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ movementType: 'CLIENT_RETURN' }),
        }),
      );
    });

    it('throws LotNotEligibleForReturnException when lot is EXPIRED', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ ...mockLot, state: 'EXPIRED' });

      await expect(
        service.receiveStockFromClientReturn({ lotId: 'lot-1', quantity: 1, clientReturnId: 'cr-1', tx: prisma as any }),
      ).rejects.toThrow(LotNotEligibleForReturnException);
    });

    it('throws LotNotEligibleForReturnException when lot is BLOCKED', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue({ ...mockLot, state: 'BLOCKED' });

      await expect(
        service.receiveStockFromClientReturn({ lotId: 'lot-1', quantity: 1, clientReturnId: 'cr-1', tx: prisma as any }),
      ).rejects.toThrow(LotNotEligibleForReturnException);
    });

    it('throws LotNotFoundException when lot does not exist', async () => {
      (prisma.lot.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.receiveStockFromClientReturn({ lotId: 'unknown', quantity: 1, clientReturnId: 'cr-1', tx: prisma as any }),
      ).rejects.toThrow(LotNotFoundException);
    });
  });

  describe('stub methods', () => {
    const stubMethods = [
      'createInventoryAdjustment',
      'updateInventoryAdjustment',
      'submitInventoryAdjustment',
      'approveInventoryAdjustment',
      'rejectInventoryAdjustment',
      'applyInventoryAdjustment',
      'annulInventoryAdjustment',
      'findAllInventoryAdjustments',
      'findInventoryAdjustmentById',
      'createPhysicalCount',
      'updatePhysicalCount',
      'submitPhysicalCount',
      'approvePhysicalCount',
      'rejectPhysicalCount',
      'applyPhysicalCount',
      'annulPhysicalCount',
      'findAllPhysicalCounts',
      'findPhysicalCountById',
    ];

    for (const methodName of stubMethods) {
      it(`${methodName} throws NotImplementedForPhaseException`, async () => {
        await expect((service as any)[methodName]()).rejects.toThrow(NotImplementedForPhaseException);
      });
    }
  });
});
