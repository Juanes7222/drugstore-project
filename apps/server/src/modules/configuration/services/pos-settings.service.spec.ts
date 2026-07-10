// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { PosSettingsService } from './pos-settings.service';

describe('PosSettingsService', () => {
  let service: PosSettingsService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new PosSettingsService(prisma as any);
  });

  describe('getPosSettings', () => {
    it('returns full settings when all configs and payment methods exist', async () => {
      const mockPaymentMethods = [
        {
          id: 'pm-1', internalCode: 'CASH', name: 'Efectivo',
          dianCode: '1', category: 'CASH', isCash: true, sortOrder: 1, isActive: true,
        },
      ];
      const mockDiscountLimits = {
        cashier: { itemMaxPercent: 10, globalMaxPercent: 5 },
        admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
        inventoryAssistant: { itemMaxPercent: 15, globalMaxPercent: 10 },
        accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
      };
      const mockAlertThresholds = { expirationWarningDays: 30, lowStockAlertEnabled: true };
      const mockSyncDefaults = { batchSize: 50, maxRetryAttempts: 5, retryDelaysSeconds: [30, 60] };

      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue(mockPaymentMethods);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce({ value: mockDiscountLimits })   // POS_DISCOUNT_LIMITS
        .mockResolvedValueOnce({ value: mockAlertThresholds })  // POS_ALERT_THRESHOLDS
        .mockResolvedValueOnce({ value: mockSyncDefaults });    // POS_SYNC_DEFAULTS

      const result = await service.getPosSettings();

      expect(result.paymentMethods).toEqual(mockPaymentMethods);
      expect(result.discountLimits).toEqual(mockDiscountLimits);
      expect(result.alertThresholds).toEqual(mockAlertThresholds);
      expect(result.syncDefaults).toEqual(mockSyncDefaults);
    });

    it('uses default values when configs are missing', async () => {
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)  // POS_DISCOUNT_LIMITS
        .mockResolvedValueOnce(null)  // POS_ALERT_THRESHOLDS
        .mockResolvedValueOnce(null); // POS_SYNC_DEFAULTS

      const result = await service.getPosSettings();

      expect(result.paymentMethods).toEqual([]);
      expect(result.discountLimits.cashier.itemMaxPercent).toBe(10);
      expect(result.discountLimits.cashier.globalMaxPercent).toBe(5);
      expect(result.discountLimits.admin.itemMaxPercent).toBe(100);
      expect(result.alertThresholds.expirationWarningDays).toBe(30);
      expect(result.alertThresholds.lowStockAlertEnabled).toBe(true);
      expect(result.syncDefaults.batchSize).toBe(10);
      expect(result.syncDefaults.maxRetryAttempts).toBe(10);
      expect(result.syncDefaults.retryDelaysSeconds).toEqual([30, 120, 300, 600, 1800]);
    });

    it('merges partial config values with defaults', async () => {
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce({ value: { cashier: { itemMaxPercent: 20 } } })  // partial discount
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getPosSettings();

      // Overridden value
      expect(result.discountLimits.cashier.itemMaxPercent).toBe(20);
      // Default fallback
      expect(result.discountLimits.cashier.globalMaxPercent).toBe(5);
      // Other roles still get defaults
      expect(result.discountLimits.admin.itemMaxPercent).toBe(100);
    });

    it('returns empty payment methods array when none are active', async () => {
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getPosSettings();

      expect(result.paymentMethods).toEqual([]);
    });
  });
});
