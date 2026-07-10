jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { FiscalIssuerConfigService } from './fiscal-issuer-config.service';
import { FiscalIssuerConfigNotSetException } from './exceptions/fiscal-issuer-config-not-set.exception';
import { FISCAL_ISSUER_CONFIG_ID } from './constants/fiscal-singleton-ids';

describe('FiscalIssuerConfigService', () => {
  let service: FiscalIssuerConfigService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new FiscalIssuerConfigService(prisma as any);
  });

  // ── find ──────────────────────────────────────────────────────────────

  describe('find', () => {
    const mockConfig = {
      id: FISCAL_ISSUER_CONFIG_ID,
      nit: '900123456',
      businessName: 'Mi Droguería SAS',
    };

    it('returns the config when it exists', async () => {
      (prisma.fiscalIssuerConfig.findUnique as jest.Mock).mockResolvedValue(mockConfig);

      const result = await service.find();

      expect(result).toEqual(mockConfig);
      expect(prisma.fiscalIssuerConfig.findUnique).toHaveBeenCalledWith({
        where: { id: FISCAL_ISSUER_CONFIG_ID },
      });
    });

    it('throws FiscalIssuerConfigNotSetException when config has never been set', async () => {
      (prisma.fiscalIssuerConfig.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.find()).rejects.toThrow(FiscalIssuerConfigNotSetException);
    });
  });

  // ── upsert ────────────────────────────────────────────────────────────

  describe('upsert', () => {
    const dto = {
      nit: '900123456',
      verificationDigit: '5',
      businessName: 'Mi Droguería SAS',
      commercialName: null,
      organizationType: '1',
      taxRegime: '48',
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
        create: { id: FISCAL_ISSUER_CONFIG_ID, ...dto, updatedById: 'user-1' },
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
        create: { id: FISCAL_ISSUER_CONFIG_ID, ...updatedDto, updatedById: 'user-2' },
        update: { ...updatedDto, updatedById: 'user-2' },
      });
    });
  });
});
