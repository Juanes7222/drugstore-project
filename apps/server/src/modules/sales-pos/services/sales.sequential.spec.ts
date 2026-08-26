import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, Prisma } from '@pharmacy/database';
import { SalesService } from './sales.service';

describe('SalesService sequential regression', () => {
  let service: SalesService;
  let prisma: DeepMockProxy<PrismaClient>;
  const mockTenant = { getSubscriptionId: jest.fn(() => 'sub-1') };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    const lotsService = mockDeep<any>();
    lotsService.consumeStockForSale = jest.fn();
    lotsService.reverseStockForSale = jest.fn();
    const fiscal = mockDeep<any>();
    const commission = { compute: jest.fn().mockReturnValue({ commissionTypeSnapshot: null, commissionValueSnapshot: null, commissionAmount: new Prisma.Decimal(0) }) } as any;
    (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
    service = new SalesService(prisma as any, lotsService, fiscal, commission, mockTenant as any);
  });

  it('create with 2 items builds sale items sequentially (no Promise.all)', async () => {
    const order: string[] = [];
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: any) => cb(prisma));
    (prisma.cashShift.findFirst as jest.Mock).mockResolvedValue({ id: 'shift-1', workstationId: 'ws-1', state: 'OPEN' });
    (prisma.client.findUnique as jest.Mock).mockResolvedValue(null); // generic path
    const prodA = { id: 'prod-a', internalCode: 'A', commercialName: 'A', concentration: '10mg', saleType: 'FREE_SALE', priceHistories: [{ price: new Prisma.Decimal(1000) }], taxHistories: [{ taxScheme: { rate: new Prisma.Decimal(0) } }], commissionType: 'NONE', commissionValue: new Prisma.Decimal(0), commissionStartsAt: null, commissionEndsAt: null };
    const prodB = { id: 'prod-b', internalCode: 'B', commercialName: 'B', concentration: '10mg', saleType: 'FREE_SALE', priceHistories: [{ price: new Prisma.Decimal(2000) }], taxHistories: [{ taxScheme: { rate: new Prisma.Decimal(0) } }], commissionType: 'NONE', commissionValue: new Prisma.Decimal(0), commissionStartsAt: null, commissionEndsAt: null };
    (prisma.product.findUnique as jest.Mock).mockImplementation(async (args: any) => {
      const id = args.where.id;
      order.push(`start-${id}`);
      await new Promise((r) => setTimeout(r, 5));
      order.push(`end-${id}`);
      return id === 'prod-a' ? prodA : prodB;
    });
    (prisma.sale.findFirst as jest.Mock).mockResolvedValue(null);
    (prisma.sale.create as jest.Mock).mockResolvedValue({ id: 'sale-1', items: [] });

    await service.create(
      { saleType: 'FREE_SALE' as any, cashShiftId: 'shift-1', items: [
        { productId: 'prod-a', quantity: 1, unitPrice: '1000.00' },
        { productId: 'prod-b', quantity: 2, unitPrice: '2000.00' },
      ] } as any,
      'user-1',
      'ws-1',
    );

    expect(order).toEqual(['start-prod-a', 'end-prod-a', 'start-prod-b', 'end-prod-b']);
  });
});
