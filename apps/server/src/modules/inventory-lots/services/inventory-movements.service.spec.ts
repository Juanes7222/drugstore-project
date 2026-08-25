import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, MovementType } from '@pharmacy/database';
import { InventoryMovementsService } from './inventory-movements.service';
import { QueryInventoryMovementDto } from '../dto/query-inventory-movement.dto';

// Mirrors the unexported MOVEMENT_LIST_INCLUDE constant in the service. If
// the service's include drifts, this assertion fails — which is the point:
// a relation that does not exist on InventoryMovement (like the removed
// createdByUser) must never reappear silently.
const EXPECTED_MOVEMENT_LIST_INCLUDE = {
  lot: {
    select: {
      id: true,
      batchNumber: true,
      productId: true,
      currentStock: true,
      state: true,
    },
  },
};

const CURSOR_TIMESTAMP = '2026-06-15T08:30:00.000Z';

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

function encodeCursorValue(lastUpdatedAt: string, lastId: string): string {
  return Buffer.from(JSON.stringify({ lastUpdatedAt, lastId })).toString('base64');
}

function decodeCursorValue(raw: string): { lastUpdatedAt: string; lastId: string } {
  return JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
}

// Newest-first ledger rows (descending createdAt), as the keyset walk reads them.
function buildLedgerRows(count: number, newestAtIso: string): Array<Record<string, unknown>> {
  const newestMs = new Date(newestAtIso).getTime();
  return Array.from({ length: count }, (_, index) => ({
    ...mockMovement,
    id: `mov-${index + 1}`,
    createdAt: new Date(newestMs - index * 60_000),
  }));
}

describe('InventoryMovementsService', () => {
  let service: InventoryMovementsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new InventoryMovementsService(prisma as any);
  });

  const findManyMock = (): jest.Mock =>
    prisma.inventoryMovement.findMany as unknown as jest.Mock;
  const countMock = (): jest.Mock =>
    prisma.inventoryMovement.count as unknown as jest.Mock;

  describe('findAll', () => {
    describe('legacy offset pagination', () => {
      it('returns movements with total, page and pageSize', async () => {
        const movements = [mockMovement];
        findManyMock().mockResolvedValue(movements);
        countMock().mockResolvedValue(1);

        const query: QueryInventoryMovementDto = { page: 1, pageSize: 20 };
        const result = await service.findAll(query);

        expect(result).toEqual({
          data: movements,
          total: 1,
          page: 1,
          pageSize: 20,
        });
        expect(findManyMock()).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {},
            skip: 0,
            take: 20,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            include: EXPECTED_MOVEMENT_LIST_INCLUDE,
          }),
        );
      });

      it('filters by lotId', async () => {
        findManyMock().mockResolvedValue([mockMovement]);
        countMock().mockResolvedValue(1);

        const query: QueryInventoryMovementDto = { page: 1, pageSize: 20, lotId: 'lot-1' };
        await service.findAll(query);

        expect(findManyMock()).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { lotId: 'lot-1' },
          }),
        );
      });

      it('filters by movementType', async () => {
        findManyMock().mockResolvedValue([]);
        countMock().mockResolvedValue(0);

        const query: QueryInventoryMovementDto = {
          page: 1,
          pageSize: 20,
          movementType: MovementType.SALE,
        };
        await service.findAll(query);

        expect(findManyMock()).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { movementType: MovementType.SALE },
          }),
        );
      });

      it('filters by createdAtFrom and createdAtTo', async () => {
        findManyMock().mockResolvedValue([]);
        countMock().mockResolvedValue(0);

        const query: QueryInventoryMovementDto = {
          page: 1,
          pageSize: 20,
          createdAtFrom: '2026-01-01',
          createdAtTo: '2026-12-31',
        };
        await service.findAll(query);

        expect(findManyMock()).toHaveBeenCalledWith(
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
        findManyMock().mockResolvedValue([]);
        countMock().mockResolvedValue(0);

        const query: QueryInventoryMovementDto = {
          page: 1,
          pageSize: 20,
          createdAtFrom: '2026-06-01',
        };
        await service.findAll(query);

        expect(findManyMock()).toHaveBeenCalledWith(
          expect.objectContaining({
            where: {
              createdAt: {
                gte: new Date('2026-06-01'),
              },
            },
          }),
        );
      });

      it('returns movements with the lot relation and no createdByUser in the include', async () => {
        // createdByUser was removed from the include: the relation never
        // existed on InventoryMovement (createdById is a bare scalar) and
        // Prisma rejected the old include at runtime.
        const movementWithLot = { ...mockMovement, lot: mockLot };
        findManyMock().mockResolvedValue([movementWithLot]);
        countMock().mockResolvedValue(1);

        const query: QueryInventoryMovementDto = { page: 1, pageSize: 20 };
        const result = await service.findAll(query);

        expect(result.data[0]).toMatchObject({
          id: 'mov-1',
          lot: expect.objectContaining({ id: 'lot-1', batchNumber: 'BATCH-001' }),
        });
        const callArgs = findManyMock().mock.calls[0][0];
        expect(callArgs.include).toEqual(EXPECTED_MOVEMENT_LIST_INCLUDE);
        expect(callArgs.include).not.toHaveProperty('createdByUser');
      });

      it('returns empty data when no movements match', async () => {
        findManyMock().mockResolvedValue([]);
        countMock().mockResolvedValue(0);

        const query: QueryInventoryMovementDto = { page: 1, pageSize: 20 };
        const result = await service.findAll(query);

        expect(result).toEqual({
          data: [],
          total: 0,
          page: 1,
          pageSize: 20,
        });
      });

      it('applies offset math on later pages', async () => {
        findManyMock().mockResolvedValue([mockMovement]);
        countMock().mockResolvedValue(21);

        const query: QueryInventoryMovementDto = { page: 2, pageSize: 10 };
        await service.findAll(query);

        expect(findManyMock()).toHaveBeenCalledWith(
          expect.objectContaining({
            skip: 10,
            take: 10,
          }),
        );
      });
    });

    describe('cursor keyset pagination', () => {
      it('walks the keyset with lt comparisons and no offset math when a cursor is present', async () => {
        findManyMock().mockResolvedValue(buildLedgerRows(3, '2026-06-20T12:00:00Z'));

        const rawCursor = encodeCursorValue(CURSOR_TIMESTAMP, 'mov-anchor');
        const query: QueryInventoryMovementDto = {
          page: 1,
          pageSize: 3,
          lotId: 'lot-1',
          cursor: rawCursor,
        };
        await service.findAll(query);

        expect(findManyMock()).toHaveBeenCalledWith({
          where: {
            lotId: 'lot-1',
            OR: [
              { createdAt: { lt: new Date(CURSOR_TIMESTAMP) } },
              { createdAt: new Date(CURSOR_TIMESTAMP), id: { lt: 'mov-anchor' } },
            ],
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 4,
          include: EXPECTED_MOVEMENT_LIST_INCLUDE,
        });
        const callArgs = findManyMock().mock.calls[0][0];
        expect(callArgs).not.toHaveProperty('skip');
        expect(callArgs).not.toHaveProperty('cursor');
        expect(countMock()).not.toHaveBeenCalled();
      });

      it('returns nextCursor and hasMore when more ledger rows exist than the page holds', async () => {
        const rows = buildLedgerRows(4, '2026-06-20T12:00:00Z');
        findManyMock().mockResolvedValue(rows);

        const query: QueryInventoryMovementDto = {
          page: 1,
          pageSize: 3,
          cursor: encodeCursorValue(CURSOR_TIMESTAMP, 'mov-anchor'),
        };
        const result = await service.findAll(query);

        expect(result.data).toEqual(rows.slice(0, 3));
        expect(result.hasMore).toBe(true);
        expect(result.total).toBeUndefined();
        expect(result.page).toBeUndefined();
        expect(result.pageSize).toBe(3);
        expect(decodeCursorValue(result.nextCursor)).toEqual({
          lastUpdatedAt: (rows[2]['createdAt'] as Date).toISOString(),
          lastId: 'mov-3',
        });
      });

      it('marks the last page when exactly pageSize rows remain', async () => {
        const rows = buildLedgerRows(3, '2026-06-20T12:00:00Z');
        findManyMock().mockResolvedValue(rows);

        const query: QueryInventoryMovementDto = {
          page: 1,
          pageSize: 3,
          cursor: encodeCursorValue(CURSOR_TIMESTAMP, 'mov-anchor'),
        };
        const result = await service.findAll(query);

        expect(result.data).toEqual(rows);
        expect(result.hasMore).toBe(false);
        expect(result.nextCursor).toBeNull();
      });
    });
  });
});
