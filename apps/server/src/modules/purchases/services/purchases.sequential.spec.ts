import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseReceptionsService } from './purchase-receptions.service';

describe('Purchases sequential regression', () => {
  const mockSuppliers = { resolveSupplierForSync: jest.fn() };
  const mockTenant = { getSubscriptionId: jest.fn(() => 'sub-1') };
  const mockLots = { resolveLotForSync: jest.fn(), receiveStock: jest.fn() };
  const mockFiscal = { createPendingDocumentForPurchaseReception: jest.fn(), enqueueGenerationJob: jest.fn() };

  it('PurchaseOrdersService.create with 2 items queries products sequentially', async () => {
    const prisma = mockDeep<PrismaClient>();
    const service = new PurchaseOrdersService(prisma as any, mockSuppliers as any, mockTenant as any);
    const order: string[] = [];
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));
    (prisma.supplier.findUnique as jest.Mock).mockResolvedValue({ id: 'sup-1' });
    (prisma.product.findUnique as jest.Mock).mockImplementation(async (args: any) => {
      const id = args.where.id;
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 3));
      order.push(`end-${id}`);
      return { id };
    });
    (prisma.purchaseOrder.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.purchaseOrder.create as jest.Mock).mockResolvedValue({ id: 'po-1' });

    await service.create(
      { supplierId: 'sup-1', items: [
        { productId: 'prod-a', requestedQuantity: 5, expectedUnitCost: 1000 },
        { productId: 'prod-b', requestedQuantity: 3, expectedUnitCost: 2000 },
      ] } as any,
      'user-1',
    );

    expect(order).toEqual(['start-prod-a', 'end-prod-a', 'start-prod-b', 'end-prod-b']);
  });

  it('PurchaseReceptionsService.create with 2 items queries products sequentially', async () => {
    const prisma = mockDeep<PrismaClient>();
    const service = new PurchaseReceptionsService(prisma as any, mockLots as any, mockFiscal as any, mockSuppliers as any, mockTenant as any);
    const order: string[] = [];
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));
    (prisma.supplier.findUnique as jest.Mock).mockResolvedValue({ id: 'sup-1' });
    (prisma.product.findUnique as jest.Mock).mockImplementation(async (args: any) => {
      const id = args.where.id;
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 3));
      order.push(`end-${id}`);
      return { id };
    });
    (prisma.purchaseOrder.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.purchaseOrderItem.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.purchaseReception.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.purchaseReception.create as jest.Mock).mockResolvedValue({ id: 'rec-1' });

    await service.create(
      { supplierId: 'sup-1', items: [
        { productId: 'prod-a', receivedQuantity: 2, realUnitCost: 1000, taxSchemeId: 'tax-1', taxRate: 19 },
        { productId: 'prod-b', receivedQuantity: 4, realUnitCost: 2000, taxSchemeId: 'tax-1', taxRate: 19 },
      ] } as any,
      'user-1',
    );

    expect(order).toEqual(['start-prod-a', 'end-prod-a', 'start-prod-b', 'end-prod-b']);
  });
});
