jest.mock('@pharmacy/database', () => {
  class MockPrismaClient {
    $connect = jest.fn();
    $disconnect = jest.fn();
  }
  return { PrismaClient: MockPrismaClient };
});

import { Test, TestingModule } from '@nestjs/testing';
import { ReportsController } from './reports.controller';
import { ReportsService } from '../services/reports.service';

const mockService = {
  getSalesSummary: jest.fn(),
  getCashShiftSummary: jest.fn(),
  getInventoryValuation: jest.fn(),
  getTaxSummary: jest.fn(),
  getFiscalReport: jest.fn(),
  getDailyReport: jest.fn(),
};

describe('ReportsController (integration)', () => {
  let controller: ReportsController;
  let service: jest.Mocked<typeof mockService>;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [{ provide: ReportsService, useValue: mockService }],
    }).compile();

    controller = module.get<ReportsController>(ReportsController);
    service = module.get(ReportsService) as jest.Mocked<typeof mockService>;
  });

  const sampleQuery = { dateFrom: '2026-01-01', dateTo: '2026-01-31' };

  describe('GET /reports/sales-summary', () => {
    it('should call getSalesSummary with query', async () => {
      const expected = { totalSales: 10, totalAmount: 50000 };
      service.getSalesSummary.mockResolvedValue(expected);

      const result = await controller.getSalesSummary(sampleQuery as any);

      expect(service.getSalesSummary).toHaveBeenCalledWith(sampleQuery);
      expect(result).toEqual(expected);
    });

    it('should propagate service error', async () => {
      service.getSalesSummary.mockRejectedValue(new Error('Invalid date range'));

      await expect(controller.getSalesSummary(sampleQuery as any)).rejects.toThrow('Invalid date range');
    });
  });

  describe('GET /reports/cash-shift-summary', () => {
    it('should call getCashShiftSummary with query', async () => {
      const expected = { totalShifts: 5, totalExpected: 100000 };
      service.getCashShiftSummary.mockResolvedValue(expected);

      const result = await controller.getCashShiftSummary(sampleQuery as any);

      expect(service.getCashShiftSummary).toHaveBeenCalledWith(sampleQuery);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /reports/inventory-valuation', () => {
    it('should call getInventoryValuation with query', async () => {
      const expected = { totalValue: 500000, products: [] };
      service.getInventoryValuation.mockResolvedValue(expected);

      const result = await controller.getInventoryValuation(sampleQuery as any);

      expect(service.getInventoryValuation).toHaveBeenCalledWith(sampleQuery);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /reports/tax-summary', () => {
    it('should call getTaxSummary with query', async () => {
      const expected = { taxBreakdown: [{ rate: 0.19, totalTax: 95000 }] };
      service.getTaxSummary.mockResolvedValue(expected);

      const result = await controller.getTaxSummary(sampleQuery as any);

      expect(service.getTaxSummary).toHaveBeenCalledWith(sampleQuery);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /reports/fiscal', () => {
    it('should call getFiscalReport with query', async () => {
      const expected = { documentsByType: {}, documentsByState: {} };
      service.getFiscalReport.mockResolvedValue(expected);

      const result = await controller.getFiscalReport(sampleQuery as any);

      expect(service.getFiscalReport).toHaveBeenCalledWith(sampleQuery);
      expect(result).toEqual(expected);
    });
  });

  describe('GET /reports/daily', () => {
    it('should call getDailyReport with query', async () => {
      const expected = { entries: [] };
      service.getDailyReport.mockResolvedValue(expected);

      const result = await controller.getDailyReport(sampleQuery as any);

      expect(service.getDailyReport).toHaveBeenCalledWith(sampleQuery);
      expect(result).toEqual(expected);
    });
  });
});
