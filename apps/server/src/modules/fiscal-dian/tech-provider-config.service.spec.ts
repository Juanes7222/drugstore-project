jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { TechProviderConfigService } from './tech-provider-config.service';
import { TechProviderConfigNotSetException } from './exceptions/tech-provider-config-not-set.exception';
import { TECH_PROVIDER_CONFIG_ID } from './constants/fiscal-singleton-ids';

describe('TechProviderConfigService', () => {
  let service: TechProviderConfigService;
  let prisma: DeepMockProxy<PrismaClient>;

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new TechProviderConfigService(prisma as any);
  });

  // ── find ──────────────────────────────────────────────────────────────

  describe('find', () => {
    const mockConfig = {
      id: TECH_PROVIDER_CONFIG_ID,
      endpointUrl: 'https://dian-test.example.com/api',
      environment: 'HABILITACION',
      timeoutSeconds: 30,
    };

    it('returns the config when it exists', async () => {
      (prisma.techProviderConfig.findUnique as jest.Mock).mockResolvedValue(mockConfig);

      const result = await service.find();

      expect(result).toEqual(mockConfig);
      expect(prisma.techProviderConfig.findUnique).toHaveBeenCalledWith({
        where: { id: TECH_PROVIDER_CONFIG_ID },
      });
    });

    it('throws TechProviderConfigNotSetException when config has never been set', async () => {
      (prisma.techProviderConfig.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.find()).rejects.toThrow(TechProviderConfigNotSetException);
    });
  });

  // ── upsert ────────────────────────────────────────────────────────────

  describe('upsert', () => {
    const dto = {
      endpointUrl: 'https://dian-prod.example.com/api',
      environment: 'PRODUCCION' as const,
      timeoutSeconds: 30,
      credentialReference: 'vault:prod/dian-cert',
    };

    it('creates a new config when no prior config exists', async () => {
      (prisma.techProviderConfig.upsert as jest.Mock).mockResolvedValue({
        id: TECH_PROVIDER_CONFIG_ID,
        ...dto,
        updatedById: 'user-1',
      });

      const result = await service.upsert(dto, 'user-1');

      expect(result).toBeDefined();
      expect(prisma.techProviderConfig.upsert).toHaveBeenCalledWith({
        where: { id: TECH_PROVIDER_CONFIG_ID },
        create: { id: TECH_PROVIDER_CONFIG_ID, ...dto, updatedById: 'user-1' },
        update: { ...dto, updatedById: 'user-1' },
      });
    });

    it('updates an existing config with new values', async () => {
      const updatedDto = {
        ...dto,
        endpointUrl: 'https://dian-updated.example.com/api',
        timeoutSeconds: 60,
      };
      (prisma.techProviderConfig.upsert as jest.Mock).mockResolvedValue({
        id: TECH_PROVIDER_CONFIG_ID,
        ...updatedDto,
        updatedById: 'user-2',
      });

      const result = await service.upsert(updatedDto, 'user-2');

      expect(result).toBeDefined();
      expect(prisma.techProviderConfig.upsert).toHaveBeenCalledWith({
        where: { id: TECH_PROVIDER_CONFIG_ID },
        create: { id: TECH_PROVIDER_CONFIG_ID, ...updatedDto, updatedById: 'user-2' },
        update: { ...updatedDto, updatedById: 'user-2' },
      });
    });
  });
});
