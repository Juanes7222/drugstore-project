import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { InventoryAdjustmentsService } from './inventory-adjustments.service';

/**
 * Regression for adapter-pg 25P02: prepareAdjustmentItems and verifyAndLoadLots
 * must run sequentially inside $transaction. Promise.all multiplexes concurrent
 * queries onto the single pg connection and aborts the transaction.
 */
describe('InventoryAdjustmentsService sequential regression', () => {
  let service: InventoryAdjustmentsService;
  let prisma: DeepMockProxy<PrismaClient>;
  const mockLotsService = { resolveLotForSync: jest.fn() };
  const mockTenant = { getSubscriptionId: jest.fn(() => 'sub-1') };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    mockLotsService.resolveLotForSync.mockReset();
    service = new InventoryAdjustmentsService(prisma as any, mockLotsService as any, mockTenant as any);
  });

  it('create with 2 items resolves lots sequentially (no Promise.all)', async () => {
    const callOrder: string[] = [];
    mockLotsService.resolveLotForSync.mockImplementation(async (_tx: unknown, lotId: string) => {
      callOrder.push(`start-${lotId}`);
      await new Promise((r) => setTimeout(r, 5));
      callOrder.push(`end-${lotId}`);
      return { id: lotId, currentStock: 50, version: 1, state: 'ACTIVE' };
    });

    const txMock: any = {
      inventoryAdjustmentCounter: { upsert: jest.fn().mockResolvedValue({ lastSequentialNumber: 1 }) },
      inventoryAdjustmentDocument: { aggregate: jest.fn().mockResolvedValue({ _max: { sequentialNumber: null } }), create: jest.fn().mockResolvedValue({ id: 'adj-1' }) },
      inventoryMovement: { create: jest.fn().mockResolvedValue({ id: 'mov' }) },
      product: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(txMock));

    await service.create(
      { reason: 'seq', items: [
        { lotId: 'lot-a', movementType: 'POSITIVE_ADJUSTMENT' as any, quantity: 1 },
        { lotId: 'lot-b', movementType: 'POSITIVE_ADJUSTMENT' as any, quantity: 2 },
      ] },
      'user-1',
    );

    // Sequential: start-a, end-a, start-b, end-b. Parallel would interleave start-a, start-b before any end.
    expect(callOrder).toEqual(['start-lot-a', 'end-lot-a', 'start-lot-b', 'end-lot-b']);
    expect(mockLotsService.resolveLotForSync).toHaveBeenCalledTimes(2);
  });

  it('apply verifies lots sequentially', async () => {
    const callOrder: string[] = [];
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));
    (prisma.inventoryAdjustmentDocument.findUnique as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'APPROVED' });
    (prisma.inventoryMovement.findMany as jest.Mock).mockResolvedValue([
      { lotId: 'lot-a', previousStock: 10, movementType: 'POSITIVE_ADJUSTMENT', quantity: 1 },
      { lotId: 'lot-b', previousStock: 20, movementType: 'POSITIVE_ADJUSTMENT', quantity: 2 },
    ]);
    (prisma.lot.findUnique as jest.Mock).mockImplementation(async (args: any) => {
      const id = args.where.id;
      callOrder.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 5));
      callOrder.push(`end-${id}`);
      return { id, currentStock: id === 'lot-a' ? 10 : 20, version: 1, state: 'ACTIVE' };
    });
    (prisma.lot.updateMany as jest.Mock).mockResolvedValue({ count: 1 });
    (prisma.inventoryAdjustmentDocument.update as jest.Mock).mockResolvedValue({ id: 'adj-1', state: 'APPLIED' });

    await service.apply('adj-1', 'user-1');

    expect(callOrder).toEqual(['start-lot-a', 'end-lot-a', 'start-lot-b', 'end-lot-b']);
  });
});
