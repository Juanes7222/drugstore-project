import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { PosSettingsService } from './pos-settings.service';
import { FiscalIssuerConfigNotSetException } from '@/modules/fiscal-dian/exceptions/fiscal-issuer-config-not-set.exception';

const ISSUER_CONFIG = {
  nit: '900123456',
  businessName: 'Mi Droguería SAS',
  address: 'Calle 123 #45-67',
  phone: '6010000000',
  municipality: 'Bogotá D.C.',
  department: 'Cundinamarca',
};

const ACTIVE_RESOLUTION = {
  id: 'res-1',
  resolutionNumber: '18764000000001',
  prefix: 'FV',
  validFrom: new Date(2026, 0, 1),
  validTo: new Date(2026, 11, 31),
  state: 'ACTIVE',
  documentType: 'INVOICE',
  rangeFrom: 100001,
  rangeTo: 200000,
  currentConsecutive: 0,
};

describe('PosSettingsService', () => {
  let service: PosSettingsService;
  let prisma: DeepMockProxy<PrismaClient>;
  const mockTenantContext = {
    getSubscriptionId: jest.fn(() => 'test-subscription-id'),
    hasTenant: jest.fn(() => true),
  };
  const mockIssuerConfigService = { find: jest.fn() };
  const mockResolutionsService = { findAll: jest.fn() };
  const mockAllocationsService = { findLatestForResolution: jest.fn() };
  const mockCertificateService = { hasActiveCertificate: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    (mockTenantContext.hasTenant as jest.Mock).mockImplementation(() => true);
    mockIssuerConfigService.find.mockResolvedValue(ISSUER_CONFIG);
    mockResolutionsService.findAll.mockResolvedValue({
      data: [ACTIVE_RESOLUTION],
      total: 1,
      page: 1,
      pageSize: 1,
    });
    mockAllocationsService.findLatestForResolution.mockResolvedValue(null);
    mockCertificateService.hasActiveCertificate.mockResolvedValue(false);
    prisma = mockDeep<PrismaClient>();
    service = new PosSettingsService(
      prisma as any,
      mockTenantContext as any,
      mockIssuerConfigService as any,
      mockResolutionsService as any,
      mockAllocationsService as any,
      mockCertificateService as any,
    );
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
        manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
        owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
      };
      const mockAlertThresholds = { expirationWarningDays: 30, lowStockAlertEnabled: true };
      const mockSyncDefaults = { batchSize: 50, maxRetryAttempts: 5, retryDelaysSeconds: [30, 60] };
      const mockSalesConfig = {
        priceOverridePermissions: {
          cashier: { allowed: false, requireReason: true },
          manager: { allowed: true, requireReason: true },
          inventoryAssistant: { allowed: false, requireReason: true },
          accountant: { allowed: false, requireReason: true },
        },
        priceFloor: { enabled: true, type: 'COST', minMarginPercent: 0 },
      };

      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue(mockPaymentMethods);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce({ value: mockDiscountLimits })   // POS_DISCOUNT_LIMITS
        .mockResolvedValueOnce({ value: mockAlertThresholds })  // POS_ALERT_THRESHOLDS
        .mockResolvedValueOnce({ value: mockSyncDefaults })     // POS_SYNC_DEFAULTS
        .mockResolvedValueOnce({ value: mockSalesConfig });     // POS_SALES_CONFIG

      const result = await service.getPosSettings();

      expect(result.paymentMethods).toEqual(mockPaymentMethods);
      expect(result.discountLimits).toEqual(mockDiscountLimits);
      expect(result.alertThresholds).toEqual(mockAlertThresholds);
      expect(result.syncDefaults).toEqual(mockSyncDefaults);
      expect(result.salesConfig).toEqual(mockSalesConfig);
    });

    it('uses default values when configs are missing', async () => {
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)  // POS_DISCOUNT_LIMITS
        .mockResolvedValueOnce(null)  // POS_ALERT_THRESHOLDS
        .mockResolvedValueOnce(null)  // POS_SYNC_DEFAULTS
        .mockResolvedValueOnce(null); // POS_SALES_CONFIG

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
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getPosSettings();

      expect(result.paymentMethods).toEqual([]);
    });
  });

  describe('buildSellerInfo', () => {
    it('omits sellerInfo and resolution when no tenant context is bound', async () => {
      (mockTenantContext.hasTenant as jest.Mock).mockImplementation(() => false);
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getPosSettings();

      expect(result.sellerInfo).toBeUndefined();
      expect(result.resolution).toBeUndefined();
      expect(mockIssuerConfigService.find).not.toHaveBeenCalled();
      expect(mockResolutionsService.findAll).not.toHaveBeenCalled();
      expect(mockAllocationsService.findLatestForResolution).not.toHaveBeenCalled();
    });

    it('omits sellerInfo but still maps resolution when the issuer config has never been set', async () => {
      mockIssuerConfigService.find.mockRejectedValue(
        new FiscalIssuerConfigNotSetException(),
      );
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getPosSettings();

      expect(result.sellerInfo).toBeUndefined();
      // The resolution is resolved independently of the issuer config.
      expect(mockResolutionsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'ACTIVE', pageSize: 1 }),
      );
      expect(result.resolution).toEqual({
        resolutionNumber: '18764000000001',
        documentType: 'INVOICE',
        prefix: 'FV',
        rangeFrom: 100001,
        rangeTo: 200000,
        validFrom: ACTIVE_RESOLUTION.validFrom.toISOString(),
        validTo: ACTIVE_RESOLUTION.validTo.toISOString(),
        currentConsecutive: 0,
        state: 'ACTIVE',
      });
    });

    it('maps the issuer config and most recent ACTIVE resolution into sellerInfo', async () => {
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getPosSettings();

      expect(result.sellerInfo).toEqual({
        nit: '900123456',
        name: 'Mi Droguería SAS',
        address: 'Calle 123 #45-67',
        phone: '6010000000',
        resolutionNumber: '18764000000001',
        resolutionDate: ACTIVE_RESOLUTION.validFrom.toISOString(),
        resolutionPrefix: 'FV',
      });
      expect(mockResolutionsService.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'ACTIVE', pageSize: 1 }),
      );
    });

    it('defaults resolutionPrefix to FE when the resolution has no prefix', async () => {
      mockResolutionsService.findAll.mockResolvedValue({
        data: [{ ...ACTIVE_RESOLUTION, prefix: null }],
        total: 1,
        page: 1,
        pageSize: 1,
      });
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getPosSettings();

      expect(result.sellerInfo?.resolutionPrefix).toBe('FE');
    });

    it('tolerates a tenant without resolutions', async () => {
      mockResolutionsService.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 1,
      });
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getPosSettings();

      expect(result.sellerInfo).toEqual({
        nit: '900123456',
        name: 'Mi Droguería SAS',
        address: 'Calle 123 #45-67',
        phone: '6010000000',
        resolutionNumber: null,
        resolutionDate: null,
        resolutionPrefix: 'FE',
      });
      expect(result.resolution).toBeNull();
    });

    it('maps null address and phone as null', async () => {
      mockIssuerConfigService.find.mockResolvedValue({
        ...ISSUER_CONFIG,
        address: null,
        phone: null,
      });
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      const result = await service.getPosSettings();

      expect(result.sellerInfo?.address).toBeNull();
      expect(result.sellerInfo?.phone).toBeNull();
    });
  });

  describe('buildResolutionPayload', () => {
    const stubConfigs = () => {
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
    };

    it('uses the live allocation counter for currentConsecutive', async () => {
      mockAllocationsService.findLatestForResolution.mockResolvedValue({
        id: 'alloc-1',
        currentConsecutive: 42,
      });
      stubConfigs();

      const result = await service.getPosSettings();

      expect(mockAllocationsService.findLatestForResolution).toHaveBeenCalledWith(
        'res-1',
      );
      expect(result.resolution).toEqual({
        resolutionNumber: '18764000000001',
        documentType: 'INVOICE',
        prefix: 'FV',
        rangeFrom: 100001,
        rangeTo: 200000,
        validFrom: ACTIVE_RESOLUTION.validFrom.toISOString(),
        validTo: ACTIVE_RESOLUTION.validTo.toISOString(),
        currentConsecutive: 42,
        state: 'ACTIVE',
      });
    });

    it('falls back to the resolution counter when the resolution has no allocation', async () => {
      mockAllocationsService.findLatestForResolution.mockResolvedValue(null);
      stubConfigs();

      const result = await service.getPosSettings();

      expect(result.resolution?.currentConsecutive).toBe(0);
    });
  });

  describe('certificateStatus', () => {
    const stubBasePayload = () => {
      (prisma.paymentMethod.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);
    };

    it('reports ACTIVE when the tenant has an active DIAN certificate', async () => {
      stubBasePayload();
      mockCertificateService.hasActiveCertificate.mockResolvedValue(true);

      const result = await service.getPosSettings();

      expect(mockCertificateService.hasActiveCertificate).toHaveBeenCalledTimes(1);
      expect(result.certificateStatus).toBe('ACTIVE');
    });

    it('reports NONE when the tenant has no active DIAN certificate', async () => {
      stubBasePayload();
      mockCertificateService.hasActiveCertificate.mockResolvedValue(false);

      const result = await service.getPosSettings();

      expect(result.certificateStatus).toBe('NONE');
    });

    it('omits certificateStatus and skips the lookup when no tenant context is bound', async () => {
      (mockTenantContext.hasTenant as jest.Mock).mockImplementation(() => false);
      stubBasePayload();

      const result = await service.getPosSettings();

      expect('certificateStatus' in result).toBe(false);
      expect(mockCertificateService.hasActiveCertificate).not.toHaveBeenCalled();
    });
  });
});