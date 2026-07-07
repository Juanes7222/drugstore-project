import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, Prisma, MovementType } from '@prisma/client';
import { InventoryMovementsService } from './inventory-movements.service';
import { QueryInventoryMovementDto } from '../dto/query-inventory-movement.dto';

jest.mock('@prisma/client', () => {
  const DecimalMock = jest.fn().mockImplementation((v: any) => ({
    toString: () => String(v),
    toNumber: () => Number(v),
    times: (o: any) => new DecimalMock(Number(v) * Number(o)),
    dividedBy: (o: any) => new DecimalMock(Number(v) / Number(o)),
    plus: (o: any) => new DecimalMock(Number(v) + Number(o)),
    minus: (o: any) => new DecimalMock(Number(v) - Number(o)),
  }));
  return {
    PrismaClient: jest.fn(),
    MovementType: {
      PURCHASE_RECEIPT: 'PURCHASE_RECEIPT',
      SALE: 'SALE',
      POSITIVE_ADJUSTMENT: 'POSITIVE_ADJUSTMENT',
      NEGATIVE_ADJUSTMENT: 'NEGATIVE_ADJUSTMENT',
      CLIENT_RETURN: 'CLIENT_RETURN',
      SUPPLIER_RETURN: 'SUPPLIER_RETURN',
      ADMIN_BLOCK: 'ADMIN_BLOCK',
      ADMIN_UNBLOCK: 'ADMIN_UNBLOCK',
      AUTO_EXPIRATION: 'AUTO_EXPIRATION',
      PHYSICAL_COUNT: 'PHYSICAL_COUNT',
      INITIAL_STOCK: 'INITIAL_STOCK',
    },
    Prisma: {
      Decimal: DecimalMock,
    },
  };
});

describe('InventoryMovementsService', () => {
  let service: InventoryMovementsService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockMovement = {
    id: 'mov-1',
    movementType: MovementType.PURCHASE_RECEIPT,
    quantity: 50,
    previousStock: 0,
    resultingStock: 50,
    createdById: 'user-1',
    createdAt: new Date('2026-06-01T10:00:00Z'),
    lotId: 'lot-1',
    reason: 'Initial stock receipt',
    adjustmentDocumentId: null,
    autoExpirationJobId: null,
    approvedByUserId: null,
    purchaseReceptionId: 'pr-1',
    saleId: null,
    supplierReturnId: null,
    clientReturnId: null,
  };

  const mockLot = {
    id: 'lot-1',
    batchNumber: 'BATCH-001',
    productId: 'prod-1',
    currentStock: 50,
    state: 'ACTIVE',
  };

  const mockUser = {
    id: 'user-1',
    fullName: 'Test User',
    username: 'testuser',
  };

  function setupTransactionMock(): void {
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => {
      if (typeof cb === 'function') return cb(prisma);
      // Array form: resolve all promises in the array
      if (Array.isArray(cb)) return Promise.all(cb);
      return cb;
    });
  }

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new InventoryMovementsService(prisma as any);
  });

  describe('findAll', () => {
    it('returns paginated movements with default pagination', async () => {
      const movements = [mockMovement];
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue(movements);
      (prisma.inventoryMovement.count as jest.Mock).mockResolvedValue(1);
      setupTransactionMock();

      const query: QueryInventoryMovementDto = { page: 1, pageSize: 20 };
      const result = await service.findAll(query);

      expect(result).toEqual({
        data: movements,
        total: 1,
        page: 1,
        pageSize: 20,
      });
      expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 20,
          orderBy: { createdAt: 'desc' },
        }),
      );
    });

    it('filters by lotId', async () => {
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([mockMovement]);
      (prisma.inventoryMovement.count as jest.Mock).mockResolvedValue(1);
      setupTransactionMock();

      const query: QueryInventoryMovementDto = { page: 1, pageSize: 20, lotId: 'lot-1' };
      await service.findAll(query);

      expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lotId: 'lot-1' },
        }),
      );
    });

    it('filters by movementType', async () => {
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.inventoryMovement.count as jest.Mock).mockResolvedValue(0);
      setupTransactionMock();

      const query: QueryInventoryMovementDto = { page: 1, pageSize: 20, movementType: MovementType.SALE };
      await service.findAll(query);

      expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { movementType: MovementType.SALE },
        }),
      );
    });

    it('filters by createdAtFrom and createdAtTo', async () => {
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.inventoryMovement.count as jest.Mock).mockResolvedValue(0);
      setupTransactionMock();

      const query: QueryInventoryMovementDto = {
        page: 1,
        pageSize: 20,
        createdAtFrom: '2026-01-01',
        createdAtTo: '2026-12-31',
      };
      await service.findAll(query);

      expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: {
              gte: new Date('2026-01-01'),
              lte: new Date('2026-12-31'),
            },
          },
        }),
      );
    });

    it('filters by createdAtFrom only', async () => {
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.inventoryMovement.count as jest.Mock).mockResolvedValue(0);
      setupTransactionMock();

      const query: QueryInventoryMovementDto = {
        page: 1,
        pageSize: 20,
        createdAtFrom: '2026-06-01',
      };
      await service.findAll(query);

      expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            createdAt: {
              gte: new Date('2026-06-01'),
            },
          },
        }),
      );
    });

    it('includes lot and createdByUser relations', async () => {
      // The service adds include relations; the mock must return data matching the full shape.
      const movementWithRelations = {
        ...mockMovement,
        lot: mockLot,
        createdByUser: mockUser,
      };
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([movementWithRelations]);
      (prisma.inventoryMovement.count as jest.Mock).mockResolvedValue(1);
      setupTransactionMock();

      const query: QueryInventoryMovementDto = { page: 1, pageSize: 20 };
      const result = await service.findAll(query);

      expect(result.data[0]).toMatchObject({
        id: 'mov-1',
        lot: expect.objectContaining({ id: 'lot-1', batchNumber: 'BATCH-001' }),
        createdByUser: expect.objectContaining({ id: 'user-1', fullName: 'Test User' }),
      });
    });

    it('returns empty data when no movements match', async () => {
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.inventoryMovement.count as jest.Mock).mockResolvedValue(0);
      setupTransactionMock();

      const query: QueryInventoryMovementDto = { page: 1, pageSize: 20 };
      const result = await service.findAll(query);

      expect(result).toEqual({
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
      });
    });

    it('handles second page correctly', async () => {
      (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([mockMovement]);
      (prisma.inventoryMovement.count as jest.Mock).mockResolvedValue(21);
      setupTransactionMock();

      const query: QueryInventoryMovementDto = { page: 2, pageSize: 10 };
      await service.findAll(query);

      expect(prisma.inventoryMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        }),
      );
    });
  });
});
