// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => {
  class MockDecimal {
    value: number;
    constructor(val: string | number) { this.value = typeof val === 'string' ? parseFloat(val) : val; }
    plus(o: MockDecimal | number) { return new MockDecimal(this.value + (typeof o === 'number' ? o : o.value)); }
    minus(o: MockDecimal | number) { return new MockDecimal(this.value - (typeof o === 'number' ? o : o.value)); }
    times(o: MockDecimal | number) { return new MockDecimal(this.value * (typeof o === 'number' ? o : o.value)); }
    dividedBy(o: MockDecimal | number) {
      const divisor = typeof o === 'number' ? o : o.value;
      return new MockDecimal(divisor === 0 ? 0 : this.value / divisor);
    }
    toFixed(n: number) { return this.value.toFixed(n); }
    toNumber() { return this.value; }
  }
  return {
    PrismaClient: jest.fn(),
    Prisma: { Decimal: MockDecimal },
  };
});

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { ReportsService } from './reports.service';

function validQuery(overrides: Record<string, unknown> = {}) {
  return {
    dateFrom: '2026-01-01',
    dateTo: '2026-01-31',
    view: 'fiscal' as const,
    ...overrides,
  };
}

describe('ReportsService', () => {
  let service: ReportsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new ReportsService(prisma as any);
  });

  describe('getSalesSummary', () => {
    it('returns aggregated sales summary for the date range', async () => {
      const mockSales = [{
        totalAmount: 10000,
        items: [
          { quantity: 2, total: 5000, product: { saleType: 'FREE_SALE' } },
          { quantity: 1, total: 5000, product: { saleType: 'PRESCRIPTION' } },
        ],
      }];
      (prisma.sale.findMany as jest.Mock).mockResolvedValue(mockSales);
      const result = await service.getSalesSummary(validQuery());
      expect(result.totalSales).toBe('10000.00');
      expect(result.totalQuantity).toBe(3);
      expect(result.breakdownBySaleType).toHaveLength(2);
    });

    it('throws ReportInvalidDateRangeException when dateFrom > dateTo', async () => {
      await expect(service.getSalesSummary(validQuery({ dateFrom: '2026-02-01', dateTo: '2026-01-01' })))
        .rejects.toThrow(/date range is invalid/);
    });

    it('handles items with null product saleType', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        { totalAmount: 5000, items: [{ quantity: 1, total: 5000, product: null }] },
      ]);
      const result = await service.getSalesSummary(validQuery());
      expect(result.totalSales).toBe('5000.00');
      expect(result.breakdownBySaleType).toHaveLength(1);
    });

    it('handles items with missing quantity and total', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        { totalAmount: 0, items: [{ product: { saleType: 'FREE_SALE' } }] },
      ]);
      const result = await service.getSalesSummary(validQuery());
      expect(result.totalQuantity).toBe(0);
      expect(result.totalSales).toBe('0.00');
    });

    it('handles sales with undefined totalAmount and items', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([{ items: undefined }]);
      const result = await service.getSalesSummary(validQuery());
      expect(result.totalQuantity).toBe(0);
      expect(result.totalSales).toBe('0.00');
    });

    it('returns zero average amount when breakdown entry has zero count', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        { totalAmount: 0, items: [{ quantity: 0, total: 0, product: { saleType: 'FREE_SALE' } }] },
      ]);
      const result = await service.getSalesSummary(validQuery());
      expect(result.breakdownBySaleType[0].averageAmount).toBe('0.00');
    });
  });

  describe('getCashShiftSummary', () => {
    it('returns cash shift summary with payment breakdown', async () => {
      (prisma.cashShift.findMany as jest.Mock).mockResolvedValue([
        { id: 'cs-1', expectedClosingAmount: 50000 },
        { id: 'cs-2', expectedClosingAmount: 30000 },
      ]);
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        { payments: [{ amount: 40000, paymentMethod: { category: 'CASH' } }, { amount: 10000, paymentMethod: { category: 'CARD' } }] },
        { payments: [{ amount: 30000, paymentMethod: { category: 'CASH' } }] },
      ]);
      const result = await service.getCashShiftSummary(validQuery());
      expect(result.totalShifts).toBe(2);
      expect(result.totalCashMovement).toBe('80000.00');
      expect(result.breakdownByPaymentMethod).toHaveLength(2);
    });

    it('returns zero values when no shifts exist', async () => {
      (prisma.cashShift.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getCashShiftSummary(validQuery());
      expect(result.totalShifts).toBe(0);
      expect(result.totalCashMovement).toBe('0.00');
      expect(result.breakdownByPaymentMethod).toEqual([]);
    });

    it('handles shifts with undefined expectedClosingAmount', async () => {
      (prisma.cashShift.findMany as jest.Mock).mockResolvedValue([{ id: 'cs-1', expectedClosingAmount: undefined }]);
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getCashShiftSummary(validQuery());
      expect(result.totalCashMovement).toBe('0.00');
    });

    it('handles payments without paymentMethod category as OTHER', async () => {
      (prisma.cashShift.findMany as jest.Mock).mockResolvedValue([{ id: 'cs-1', expectedClosingAmount: 10000 }]);
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        { payments: [{ amount: 10000, paymentMethod: null }] },
      ]);
      const result = await service.getCashShiftSummary(validQuery());
      expect(result.breakdownByPaymentMethod[0].paymentMethodCategory).toBe('OTHER');
    });

    it('handles sales with undefined or empty payments', async () => {
      (prisma.cashShift.findMany as jest.Mock).mockResolvedValue([{ id: 'cs-1', expectedClosingAmount: 5000 }]);
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([{ payments: undefined }, {}]);
      const result = await service.getCashShiftSummary(validQuery());
      expect(result.totalCashMovement).toBe('5000.00');
      expect(result.breakdownByPaymentMethod).toEqual([]);
    });
  });

  describe('getInventoryValuation', () => {
    it('returns valuation breakdown by product', async () => {
      (prisma.lot.findMany as jest.Mock).mockResolvedValue([
        { id: 'lot-1', currentStock: 10, expirationDate: new Date('2027-01-01'), product: { id: 'prod-1', commercialName: 'Product A' }, purchaseReceptionItems: [{ realUnitCost: 5000 }] },
        { id: 'lot-2', currentStock: 5, expirationDate: new Date('2026-06-01'), product: { id: 'prod-2', commercialName: 'Product B' }, purchaseReceptionItems: [{ realUnitCost: 2000 }] },
      ]);
      const result = await service.getInventoryValuation(validQuery());
      expect(result.totalLotsActive).toBe(2);
      expect(result.breakdownByProduct).toHaveLength(2);
      expect(result.totalInventoryValue).toBe('60000.00');
    });

    it('tracks lots with unknown cost separately', async () => {
      (prisma.lot.findMany as jest.Mock).mockResolvedValue([
        { id: 'lot-1', currentStock: 10, expirationDate: new Date('2027-01-01'), product: { id: 'prod-1', commercialName: 'Product A' }, purchaseReceptionItems: [] },
      ]);
      const result = await service.getInventoryValuation(validQuery());
      expect(result.lotsWithUnknownCost).toBe(1);
      expect(result.totalInventoryValue).toBe('0.00');
    });

    it('handles lots with null realUnitCost', async () => {
      (prisma.lot.findMany as jest.Mock).mockResolvedValue([
        { id: 'lot-nc', currentStock: 10, expirationDate: new Date('2027-01-01'), product: { id: 'prod-1', commercialName: 'Product A' }, purchaseReceptionItems: [{ realUnitCost: null }] },
      ]);
      const result = await service.getInventoryValuation(validQuery());
      expect(result.totalInventoryValue).toBe('0.00');
    });

    it('flags lots expiring before the threshold date', async () => {
      (prisma.lot.findMany as jest.Mock).mockResolvedValue([
        { id: 'lot-expiring', currentStock: 5, expirationDate: new Date('2026-02-15'), product: { id: 'prod-1', commercialName: 'Product A' }, purchaseReceptionItems: [{ realUnitCost: 1000 }] },
      ]);
      const result = await service.getInventoryValuation(validQuery({ dateFrom: '2026-01-01' }));
      expect(result.totalLotsExpiring).toBe(1);
      expect(result.totalLotsActive).toBe(1);
    });

    it('aggregates multiple lots with the same product ID', async () => {
      (prisma.lot.findMany as jest.Mock).mockResolvedValue([
        { id: 'lot-a', currentStock: 10, expirationDate: new Date('2027-01-01'), product: { id: 'prod-1', commercialName: 'Product A' }, purchaseReceptionItems: [{ realUnitCost: 5000 }] },
        { id: 'lot-b', currentStock: 20, expirationDate: new Date('2028-01-01'), product: { id: 'prod-1', commercialName: 'Product A' }, purchaseReceptionItems: [{ realUnitCost: 6000 }] },
      ]);
      const result = await service.getInventoryValuation(validQuery());
      expect(result.breakdownByProduct).toHaveLength(1);
      expect(result.totalInventoryValue).toBe('170000.00');
    });
  });

  describe('getTaxSummary', () => {
    it('returns tax breakdown grouped by rate', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([
        { sale: { items: [{ taxRate: 0.19, subtotal: 10000, taxAmount: 1900 }, { taxRate: 0.19, subtotal: 5000, taxAmount: 950 }] } },
        { sale: { items: [{ taxRate: 0.00, subtotal: 8000, taxAmount: 0 }] } },
      ]);
      const result = await service.getTaxSummary(validQuery());
      expect(result.totalDocuments).toBe(2);
      expect(result.breakdownByTaxRate).toHaveLength(2);
      expect(result.breakdownByTaxRate[0]).toMatchObject({ taxRate: '0.0000', taxableBase: '8000.00' });
    });

    it('merges multiple items into same tax rate bucket', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([
        { sale: { items: [{ taxRate: 0.19, subtotal: 5000, taxAmount: 950 }, { taxRate: 0.19, subtotal: 3000, taxAmount: 570 }] } },
      ]);
      const result = await service.getTaxSummary(validQuery());
      expect(result.breakdownByTaxRate).toHaveLength(1);
      expect(result.breakdownByTaxRate[0].taxableBase).toBe('8000.00');
    });

    it('handles fiscal documents with null sale', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([
        { sale: null },
        { sale: { items: [] } },
      ]);
      const result = await service.getTaxSummary(validQuery());
      expect(result.totalDocuments).toBe(2);
      expect(result.breakdownByTaxRate).toEqual([]);
    });
  });

  describe('getFiscalReport', () => {
    it('returns fiscal document breakdown by type and state', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([
        { documentType: 'INVOICE', fiscalState: 'VALIDATED', subtotal: 10000, totalTax: 1900, totalAmount: 11900 },
        { documentType: 'INVOICE', fiscalState: 'PENDING_GENERATION', subtotal: 5000, totalTax: 0, totalAmount: 5000 },
        { documentType: 'CREDIT_NOTE', fiscalState: 'VALIDATED', subtotal: 2000, totalTax: 0, totalAmount: 2000 },
      ]);
      const result = await service.getFiscalReport(validQuery());
      expect(result.totalDocuments).toBe(3);
      expect(result.breakdownByType).toHaveLength(2);
      expect(result.breakdownByType[0].documentType).toBe('CREDIT_NOTE');
      expect(result.breakdownByType[1].documentType).toBe('INVOICE');
    });

    it('returns empty breakdown when no documents exist', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getFiscalReport(validQuery());
      expect(result.totalDocuments).toBe(0);
      expect(result.breakdownByType).toEqual([]);
    });

    it('handles documents with undefined documentType and fiscalState', async () => {
      (prisma.fiscalDocument.findMany as jest.Mock).mockResolvedValue([
        { subtotal: 1000, totalTax: 100, totalAmount: 1100 },
      ]);
      const result = await service.getFiscalReport(validQuery());
      expect(result.totalDocuments).toBe(1);
      expect(result.breakdownByType[0].documentType).toBe('UNKNOWN');
      expect(result.breakdownByType[0].states[0].state).toBe('UNKNOWN');
    });
  });

  describe('getDailyReport', () => {
    it('returns daily sales aggregation', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        { id: 's1', confirmedAt: new Date('2026-01-01T10:00:00Z'), totalAmount: 50000, totalTax: 9500, items: [{ quantity: 3 }] },
        { id: 's2', confirmedAt: new Date('2026-01-01T14:00:00Z'), totalAmount: 30000, totalTax: 5700, items: [{ quantity: 1 }] },
        { id: 's3', confirmedAt: new Date('2026-01-02T10:00:00Z'), totalAmount: 20000, totalTax: 3800, items: [{ quantity: 2 }] },
      ]);
      const result = await service.getDailyReport(validQuery());
      expect(result.totalDays).toBe(2);
      expect(result.totals.totalSales).toBe(3);
      expect(result.totals.totalAmount).toBe('100000.00');
      expect(result.dailyEntries).toHaveLength(2);
      expect(result.dailyEntries[0].date).toBe('2026-01-01');
      expect(result.dailyEntries[0].salesCount).toBe(2);
      expect(result.dailyEntries[0].averageTicket).toBe('40000.00');
    });

    it('returns empty daily entries when no sales exist', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([]);
      const result = await service.getDailyReport(validQuery());
      expect(result.totalDays).toBe(0);
      expect(result.totals.totalSales).toBe(0);
      expect(result.dailyEntries).toEqual([]);
    });

    it('skips sales with null confirmedAt', async () => {
      (prisma.sale.findMany as jest.Mock).mockResolvedValue([
        { id: 's1', confirmedAt: null, totalAmount: 50000, totalTax: 9500, items: [{ quantity: 3 }] },
      ]);
      const result = await service.getDailyReport(validQuery());
      expect(result.totalDays).toBe(0);
    });
  });
});
