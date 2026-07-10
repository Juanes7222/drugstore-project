// Mock @pharmacy/database before any imports that depend on it
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { ConfigurationService } from './configuration.service';
import { ConfigValueTypeMismatchException } from '../exceptions/config-value-type-mismatch.exception';
import { ImmutableConfigFieldException } from '../exceptions/immutable-config-field.exception';
import { RoleType } from '@pharmacy/shared-types';

describe('ConfigurationService', () => {
  let service: ConfigurationService;
  let prisma: DeepMockProxy<PrismaClient>;

  const adminUser = { id: 'u1', role: RoleType.ADMIN } as any;
  const cashierUser = { id: 'u2', role: RoleType.CASHIER } as any;

  const sensitiveConfig = {
    key: 'API_SECRET',
    value: 'super-secret-value',
    valueType: 'STRING',
    module: 'SYSTEM',
    isSensitive: true,
    description: 'API Secret key',
  };

  const normalConfig = {
    key: 'APP_NAME',
    value: 'Droguería',
    valueType: 'STRING',
    module: 'SYSTEM',
    isSensitive: false,
    description: 'Application name',
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    service = new ConfigurationService(prisma as any);
  });

  // ── findAll ──────────────────────────────────────────────────────────

  describe('findAll', () => {
    it('returns all configs with real values for ADMIN', async () => {
      (prisma.systemConfig.findMany as jest.Mock).mockResolvedValue([sensitiveConfig, normalConfig]);

      const result = await service.findAll(adminUser);

      expect(result).toHaveLength(2);
      expect(result[0].value).toBe('super-secret-value');
      expect(result[1].value).toBe('Droguería');
    });

    it('masks sensitive values for non-ADMIN roles', async () => {
      (prisma.systemConfig.findMany as jest.Mock).mockResolvedValue([sensitiveConfig, normalConfig]);

      const result = await service.findAll(cashierUser);

      expect(result).toHaveLength(2);
      expect(result[0].value).toBeNull();
      expect(result[1].value).toBe('Droguería');
    });
  });

  // ── findByKey ────────────────────────────────────────────────────────

  describe('findByKey', () => {
    it('returns the config with real value for ADMIN', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(sensitiveConfig);

      const result = await service.findByKey('API_SECRET', adminUser);

      expect(result).toEqual(sensitiveConfig);
    });

    it('masks sensitive value for non-ADMIN', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(sensitiveConfig);

      const result = await service.findByKey('API_SECRET', cashierUser);

      expect(result.value).toBeNull();
    });

    it('returns null when key does not exist', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.findByKey('NONEXISTENT', adminUser);

      expect(result).toBeNull();
    });
  });

  // ── upsertByKey ──────────────────────────────────────────────────────

  describe('upsertByKey', () => {
    const validCreateDto = {
      module: 'SYSTEM',
      description: 'App name',
      isSensitive: false,
      configValue: { valueType: 'STRING' as const, value: 'Droguería' },
    };

    it('creates a new config entry when key does not exist', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);
      const created = { key: 'APP_NAME', value: 'Droguería', valueType: 'STRING', module: 'SYSTEM' };
      (prisma.systemConfig.create as jest.Mock).mockResolvedValue(created);

      const result = await service.upsertByKey('APP_NAME', validCreateDto, adminUser);

      expect(result).toEqual(created);
      expect(prisma.systemConfig.create).toHaveBeenCalled();
    });

    it('updates existing config without changing identity fields', async () => {
      const existing = { key: 'APP_NAME', value: 'Old', valueType: 'STRING', module: 'SYSTEM', isSensitive: false };
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(existing);
      const updateDto = {
        module: 'SYSTEM',
        description: 'Updated description',
        isSensitive: false,
        configValue: { valueType: 'STRING' as const, value: 'New Droguería' },
      };
      const updated = { key: 'APP_NAME', value: 'New Droguería', valueType: 'STRING', module: 'SYSTEM' };
      (prisma.systemConfig.update as jest.Mock).mockResolvedValue(updated);

      const result = await service.upsertByKey('APP_NAME', updateDto, adminUser);

      expect(result.value).toBe('New Droguería');
    });

    it('throws ImmutableConfigFieldException when module changes', async () => {
      const existing = { key: 'CFG', value: 'v1', valueType: 'STRING', module: 'POS' };
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(existing);

      await expect(
        service.upsertByKey('CFG', { ...validCreateDto, module: 'SYSTEM' }, adminUser),
      ).rejects.toThrow(ImmutableConfigFieldException);
    });

    it('throws ImmutableConfigFieldException when valueType changes', async () => {
      const existing = { key: 'CFG', value: '42', valueType: 'STRING', module: 'SYSTEM' };
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(existing);

      await expect(
        service.upsertByKey(
          'CFG',
          { ...validCreateDto, configValue: { valueType: 'NUMBER' as const, value: 42 } },
          adminUser,
        ),
      ).rejects.toThrow(ImmutableConfigFieldException);
    });

    it('throws ConfigValueTypeMismatchException when value does not match valueType', async () => {
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.upsertByKey(
          'TEST',
          {
            module: 'SYSTEM',
            description: 'Test',
            isSensitive: false,
            configValue: { valueType: 'NUMBER' as const, value: 'not-a-number' },
          },
          adminUser,
        ),
      ).rejects.toThrow(ConfigValueTypeMismatchException);
    });
  });
});
