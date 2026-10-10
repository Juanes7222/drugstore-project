import { createPrismaDatabaseMock } from '../../../../test/helpers/prisma-database-mock';

// Enum values come from the real generated client via the shared helper,
// so they cannot drift when the schema changes.
jest.mock('@pharmacy/database', () => createPrismaDatabaseMock());

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { ConfigurationService } from './configuration.service';
import { ConfigValueTypeMismatchException } from '../exceptions/config-value-type-mismatch.exception';
import { ImmutableConfigFieldException } from '../exceptions/immutable-config-field.exception';
import { RoleType } from '@pharmacy/shared-types';

describe('ConfigurationService', () => {
  let service: ConfigurationService;
  let prisma: DeepMockProxy<PrismaClient>;

  const mockTenantContext = {
    getSubscriptionId: jest.fn(() => 'test-subscription-id'),
    hasTenant: jest.fn(() => true),
  };

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
    service = new ConfigurationService(prisma as any, mockTenantContext as any);
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

  // ── updatePosSalesSettings ───────────────────────────────────────────

  describe('updatePosSalesSettings', () => {
    const ownerUser = { id: 'u-owner', role: RoleType.OWNER } as any;

    const limits = {
      cashier: { itemMaxPercent: 10, globalMaxPercent: 5 },
      admin: { itemMaxPercent: 100, globalMaxPercent: 100 },
      inventoryAssistant: { itemMaxPercent: 15, globalMaxPercent: 10 },
      accountant: { itemMaxPercent: 0, globalMaxPercent: 0 },
      owner: { itemMaxPercent: 100, globalMaxPercent: 100 },
      manager: { itemMaxPercent: 25, globalMaxPercent: 20 },
    };

    const salesConfig = {
      priceOverridePermissions: {
        cashier: { allowed: false, requireReason: true },
        manager: { allowed: true, requireReason: true },
        inventoryAssistant: { allowed: false, requireReason: true },
        accountant: { allowed: false, requireReason: true },
      },
      priceFloor: { enabled: true, type: 'COST' as const, minMarginPercent: 0 },
      creditEnabled: true,
      defaultCreditLimitCents: 25_000_000,
    };

    beforeEach(() => {
      // No existing row, so the create branch runs.
      (prisma.systemConfig.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.systemConfig.create as jest.Mock).mockResolvedValue({});
    });

    it('writes both keys scoped to the tenant when both blocks are supplied', async () => {
      await service.updatePosSalesSettings(
        { discountLimits: limits, salesConfig } as any,
        ownerUser,
      );

      expect(prisma.systemConfig.create).toHaveBeenCalledTimes(2);

      const keys = (prisma.systemConfig.create as jest.Mock).mock.calls.map(
        (call) => call[0].data.key,
      );
      expect(keys).toEqual(
        expect.arrayContaining(['POS_DISCOUNT_LIMITS', 'POS_SALES_CONFIG']),
      );

      for (const call of (prisma.systemConfig.create as jest.Mock).mock.calls) {
        // Tenant scoping is what makes this global-per-pharmacy rather than
        // global across the platform.
        expect(call[0].data.subscriptionId).toBe('test-subscription-id');
        expect(call[0].data.valueType).toBe('OBJECT');
      }
    });

    it('writes only the block supplied, so a partial edit cannot blank the other', async () => {
      await service.updatePosSalesSettings({ discountLimits: limits } as any, ownerUser);

      expect(prisma.systemConfig.create).toHaveBeenCalledTimes(1);
      expect((prisma.systemConfig.create as jest.Mock).mock.calls[0][0].data.key).toBe(
        'POS_DISCOUNT_LIMITS',
      );
    });
  });
});
