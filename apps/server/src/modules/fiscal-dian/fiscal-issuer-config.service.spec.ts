import { createPrismaDatabaseMock } from '../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { FiscalIssuerConfigService } from './fiscal-issuer-config.service';
import { FiscalIssuerConfigNotSetException } from './exceptions/fiscal-issuer-config-not-set.exception';
import { FISCAL_ISSUER_CONFIG_ID } from './constants/fiscal-singleton-ids';
import { QueryFiscalResolutionsDto } from './dto/query-fiscal-resolutions.dto';

describe('FiscalIssuerConfigService', () => {
  let service: FiscalIssuerConfigService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockTenantContext = {
    getSubscriptionId: jest.fn(() => 'test-subscription-id'),
    hasTenant: jest.fn(() => true),
  };

  const mockResolutionsService = {
    findAll: jest.fn(),
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    jest.clearAllMocks();
    service = new FiscalIssuerConfigService(
      prisma as any,
      mockTenantContext as any,
      mockResolutionsService as any,
    );
  });

  // ── find ──────────────────────────────────────────────────────────────

  describe('find', () => {
    const mockConfig = {
      id: FISCAL_ISSUER_CONFIG_ID,
      nit: '900123456',
      businessName: 'Mi Droguería SAS',
    };

    it('returns the config with the most recent active resolution', async () => {
      (prisma.fiscalIssuerConfig.findUnique as jest.Mock).mockResolvedValue(
        mockConfig,
      );
      const resolution = {
        id: 'resolution-1',
        prefix: 'SETP',
        rangeFrom: 1,
        rangeTo: 500,
        validFrom: new Date('2026-01-01'),
        validTo: new Date('2027-01-01'),
        state: 'ACTIVE',
      };
      mockResolutionsService.findAll.mockResolvedValue({
        data: [resolution],
        total: 1,
        page: 1,
        pageSize: 1,
      });

      const result = await service.find();

      expect(result).toEqual({ ...mockConfig, resolution });
      expect(prisma.fiscalIssuerConfig.findUnique).toHaveBeenCalledWith({
        where: { id: FISCAL_ISSUER_CONFIG_ID },
      });
      const query: QueryFiscalResolutionsDto =
        mockResolutionsService.findAll.mock.calls[0][0];
      expect(query.state).toBe('ACTIVE');
      expect(query.pageSize).toBe(1);
    });

    it('returns resolution null when no active resolution exists', async () => {
      (prisma.fiscalIssuerConfig.findUnique as jest.Mock).mockResolvedValue(
        mockConfig,
      );
      mockResolutionsService.findAll.mockResolvedValue({
        data: [],
        total: 0,
        page: 1,
        pageSize: 1,
      });

      const result = await service.find();

      expect(result).toEqual({ ...mockConfig, resolution: null });
    });

    it('throws FiscalIssuerConfigNotSetException when config has never been set', async () => {
      (prisma.fiscalIssuerConfig.findUnique as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(service.find()).rejects.toThrow(
        FiscalIssuerConfigNotSetException,
      );
      expect(mockResolutionsService.findAll).not.toHaveBeenCalled();
    });
  });

  // ── upsert ────────────────────────────────────────────────────────────

  describe('upsert', () => {
    const dto = {
      nit: '900123456',
      verificationDigit: '8',
      businessName: 'Mi Droguería SAS',
      commercialName: null,
      organizationType: '1',
      taxRegime: 'R-99-PJ',
      taxResponsibilities: null,
      address: 'Calle 123',
      municipality: 'Bogotá',
      department: 'Cundinamarca',
      postalCode: null,
      phone: null,
      email: null,
      logoUrl: null,
    };

    it('creates a new config when no prior config exists', async () => {
      (prisma.fiscalIssuerConfig.upsert as jest.Mock).mockResolvedValue({
        id: FISCAL_ISSUER_CONFIG_ID,
        ...dto,
        updatedById: 'user-1',
      });

      const result = await service.upsert(dto, 'user-1');

      expect(result).toBeDefined();
      expect(prisma.fiscalIssuerConfig.upsert).toHaveBeenCalledWith({
        where: { id: FISCAL_ISSUER_CONFIG_ID },
        create: {
          id: FISCAL_ISSUER_CONFIG_ID,
          subscriptionId: 'test-subscription-id',
          ...dto,
          updatedById: 'user-1',
        },
        update: { ...dto, updatedById: 'user-1' },
      });
    });

    it('updates an existing config', async () => {
      const updatedDto = { ...dto, businessName: 'Nuevo Nombre SAS' };
      (prisma.fiscalIssuerConfig.upsert as jest.Mock).mockResolvedValue({
        id: FISCAL_ISSUER_CONFIG_ID,
        ...updatedDto,
        updatedById: 'user-2',
      });

      const result = await service.upsert(updatedDto, 'user-2');

      expect(result).toBeDefined();
      expect(prisma.fiscalIssuerConfig.upsert).toHaveBeenCalledWith({
        where: { id: FISCAL_ISSUER_CONFIG_ID },
        create: {
          id: FISCAL_ISSUER_CONFIG_ID,
          subscriptionId: 'test-subscription-id',
          ...updatedDto,
          updatedById: 'user-2',
        },
        update: { ...updatedDto, updatedById: 'user-2' },
      });
    });
  });
});
