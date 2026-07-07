import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient, Prisma } from '@prisma/client';
import { ClientReturnCalculatorService } from './client-return-calculator.service';
import { SaleItemNotFoundException } from '../exceptions/sale-item-not-found.exception';
import { ReturnQuantityExceedsAvailableException } from '../exceptions/return-quantity-exceeds-available.exception';

jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn(),
  ClientReturnState: { DRAFT: 'DRAFT', CONFIRMED: 'CONFIRMED', CANCELLED: 'CANCELLED' },
  Prisma: {
    Decimal: class Decimal {
      constructor(private val: number | string | Decimal) {
        if (typeof val === 'object' && 'val' in val) {
          this.val = (val as any).val;
        }
      }
      get value(): number { return typeof this.val === 'string' ? parseFloat(this.val) : typeof this.val === 'number' ? this.val : 0; }
      times(other: any): Decimal { return new Decimal(this.value * (other instanceof Decimal ? other.value : other)); }
      dividedBy(other: any): Decimal { return new Decimal(this.value / (other instanceof Decimal ? other.value : other)); }
      plus(other: any): Decimal { return new Decimal(this.value + (other instanceof Decimal ? other.value : other)); }
      minus(other: any): Decimal { return new Decimal(this.value - (other instanceof Decimal ? other.value : other)); }
      toNumber(): number { return this.value; }
      equals(other: any): boolean { return this.value === (other instanceof Decimal ? other.value : other); }
      greaterThan(other: any): boolean { return this.value > (other instanceof Decimal ? other.value : other); }
      toString(): string { return String(this.value); }
    },
  },
}));

describe('ClientReturnCalculatorService', () => {
  let service: ClientReturnCalculatorService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new ClientReturnCalculatorService(prisma as any);
  });

  const mockSaleItem = {
    id: 'si-1',
    quantity: 10,
    unitPrice: new Prisma.Decimal(5000),
    product: {
      currentPrice: { price: new Prisma.Decimal(5500) },
      currentTaxHistory: { taxScheme: { rate: new Prisma.Decimal(19) } },
    },
    lots: [
      { lotId: 'lot-1', quantity: 6 },
      { lotId: 'lot-2', quantity: 4 },
    ],
  };

  let mockTx: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    mockTx = prisma;
  });

  describe('prepareReturnItem', () => {
    it('computes prices and lot assignments for a return item', async () => {
      (prisma.saleItem.findUnique as jest.Mock).mockResolvedValue(mockSaleItem);
      (prisma.clientReturnItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 0 } });

      const result = await service.prepareReturnItem(mockTx as any, 'sale-1', {
        saleItemId: 'si-1',
        quantity: 3,
      });

      expect(result.saleItemId).toBe('si-1');
      expect(result.quantity).toBe(3);
      expect(result.unitPriceAtSale.toNumber()).toBe(5000);
      expect(result.unitPriceAtReturn.toNumber()).toBe(5500);
      // grossAmount = 5500 * 3 = 16500
      // taxAmount = 16500 * (19/100) = 16500 * 0.19 = 3135
      expect(result.taxAmount.toNumber()).toBe(3135);
      expect(result.totalAmount.toNumber()).toBe(19635); // 16500 + 3135
    });

    it('distributes lot assignments from sale item lots when no explicit lots given', async () => {
      (prisma.saleItem.findUnique as jest.Mock).mockResolvedValue(mockSaleItem);
      (prisma.clientReturnItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 0 } });

      const result = await service.prepareReturnItem(mockTx as any, 'sale-1', {
        saleItemId: 'si-1',
        quantity: 5,
      });

      expect(result.lots).toHaveLength(1);
      expect(result.lots[0]).toEqual({ lotId: 'lot-1', quantity: 5 });
    });

    it('uses explicit lots when provided', async () => {
      (prisma.saleItem.findUnique as jest.Mock).mockResolvedValue(mockSaleItem);
      (prisma.clientReturnItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 0 } });

      const result = await service.prepareReturnItem(mockTx as any, 'sale-1', {
        saleItemId: 'si-1',
        quantity: 3,
        lots: [{ lotId: 'lot-2', quantity: 3 }],
      });

      expect(result.lots).toEqual([{ lotId: 'lot-2', quantity: 3 }]);
    });

    it('throws SaleItemNotFoundException when sale item does not exist', async () => {
      (prisma.saleItem.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.prepareReturnItem(mockTx as any, 'sale-1', { saleItemId: 'unknown', quantity: 1 }),
      ).rejects.toThrow(SaleItemNotFoundException);
    });

    it('throws ReturnQuantityExceedsAvailableException when quantity exceeds available', async () => {
      (prisma.saleItem.findUnique as jest.Mock).mockResolvedValue(mockSaleItem);
      (prisma.clientReturnItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 0 } });

      await expect(
        service.prepareReturnItem(mockTx as any, 'sale-1', { saleItemId: 'si-1', quantity: 99 }),
      ).rejects.toThrow(ReturnQuantityExceedsAvailableException);
    });
  });

  describe('getAlreadyReturnedQuantity', () => {
    it('returns the sum of previously returned quantities', async () => {
      (prisma.clientReturnItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: 7 } });

      const result = await service.getAlreadyReturnedQuantity(mockTx as any, 'si-1');

      expect(result).toBe(7);
    });

    it('returns 0 when no previous returns exist', async () => {
      (prisma.clientReturnItem.aggregate as jest.Mock).mockResolvedValue({ _sum: { quantity: null } });

      const result = await service.getAlreadyReturnedQuantity(mockTx as any, 'si-1');

      expect(result).toBe(0);
    });
  });

  describe('getDefaultRefundMethod', () => {
    it('returns the paymentMethodId of the first payment on the sale', async () => {
      (prisma.salePayment.findFirst as jest.Mock).mockResolvedValue({ paymentMethodId: 'pm-cash' });

      const result = await service.getDefaultRefundMethod(mockTx as any, 'sale-1');

      expect(result).toBe('pm-cash');
    });
  });

  describe('getNextSequentialNumber', () => {
    it('returns the next sequential number', async () => {
      (prisma.clientReturn.findFirst as jest.Mock).mockResolvedValue({ sequentialNumber: 42 });

      const result = await service.getNextSequentialNumber(mockTx as any);

      expect(result).toBe(43);
    });

    it('returns 1 when no previous returns exist', async () => {
      (prisma.clientReturn.findFirst as jest.Mock).mockResolvedValue(null);

      const result = await service.getNextSequentialNumber(mockTx as any);

      expect(result).toBe(1);
    });
  });
});
