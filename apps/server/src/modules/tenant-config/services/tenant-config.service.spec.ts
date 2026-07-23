// ---------------------------------------------------------------------------
// Tests for TenantConfigService — fiscal validation guard in update() and
// createDefaultAndUpdate().
// ---------------------------------------------------------------------------

// Mock @pharmacy/database before any imports that depend on the generated Prisma client
jest.mock('@pharmacy/database', () => ({
  PrismaClient: jest.fn(),
  Prisma: {
    JsonNull: 'JsonNull',
  },
}));

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';
import { PrismaClient } from '@pharmacy/database';
import { TenantConfigService } from './tenant-config.service';
import { ConfigValidationService } from './config-validation.service';
import { ConfigVersionConflictException } from '../exceptions/config-version-conflict.exception';
import { ConfigValidationException } from '../exceptions/config-validation.exception';
import type { FiscalConfig, StrictnessConfig, WorkflowConfig } from '@pharmacy/shared-types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SUBSCRIPTION_ID = 'sub-tenant-config-test';
const ACTOR_USER_ID = 'user-owner-1';
const ACTOR_ROLE = 'OWNER';

const FULL_STRICTNESS: StrictnessConfig = {
  lots: 'OPTIONAL',
  expiryDates: 'OPTIONAL',
  stockValidation: 'WARN',
  clientRequired: 'ABOVE_AMOUNT',
  clientRequiredThreshold: 50000,
  prescriptionEnforcement: 'STRICT',
  inventoryAdjustmentReason: 'OPTIONAL',
  returnsRequireOriginalSale: 'STRICT',
  cashShiftRequired: true,
  receiptPrintRequired: 'STRICT',
  autoOpenDrawer: 'CASH_ONLY',
  customerDisplayRequired: false,
  prescriptionExpiryDays: 180,
};

const FULL_WORKFLOW: WorkflowConfig = {
  defaultPaymentMethodId: null,
  autoPrintOnConfirm: true,
  autoOpenDrawerOnConfirm: 'CASH_ONLY',
  printDuplicateReceipt: false,
  requireShiftOpenForSale: true,
  maxOfflineLoginDays: 30,
  sessionIdleTimeoutSeconds: 600,
  sessionIdleTimeouts: { cashier: 600, manager: 1800, owner: 3600 },
  suggestionEngineEnabled: true,
  autoReprintLastReceiptOnReprint: true,
};

const FULL_FISCAL: FiscalConfig = {
  companyName: 'Mi Farmacia Ltda',
  nit: '123456789',
  address: 'Carrera 45 #23-12',
  city: 'Bogotá',
  phone: '6015551234',
  email: 'contacto@mifarmacia.com',
  logoPath: null,
  taxRegime: 'RESPONSABLE_IVA',
  defaultTaxRate: 19,
  additionalTaxes: [],
  invoiceHeader: 'Header',
  invoiceFooter: 'Footer',
  dianResolutionNumber: 'DIAN-RES-2025-001',
  dianResolutionDate: '2025-01-15',
  dianResolutionPrefix: 'SETP',
  dianTechnicalKey: '',
  invoiceNumberFormat: 'SETP-{number}',
  showLogoOnReceipt: false,
  showQrOnReceipt: true,
  qrContent: 'INVOICE_URL',
  qrCustomContent: null,
};

const EMPTY_FISCAL: FiscalConfig = {
  companyName: '',
  nit: '',
  address: '',
  city: '',
  phone: '',
  email: '',
  logoPath: null,
  taxRegime: 'RESPONSABLE_IVA',
  defaultTaxRate: 19,
  additionalTaxes: [],
  invoiceHeader: '',
  invoiceFooter: '',
  dianResolutionNumber: '',
  dianResolutionDate: '',
  dianResolutionPrefix: '',
  dianTechnicalKey: '',
  invoiceNumberFormat: '',
  showLogoOnReceipt: false,
  showQrOnReceipt: false,
  qrContent: 'INVOICE_URL',
  qrCustomContent: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMockConfigRow(overrides?: Partial<Record<string, unknown>>): any {
  return {
    id: 'tc_test_001',
    subscriptionId: SUBSCRIPTION_ID,
    activePresetCode: 'BALANCED',
    strictness: { ...FULL_STRICTNESS },
    fiscal: { ...EMPTY_FISCAL },
    workflow: { ...FULL_WORKFLOW },
    customCompanyFields: [],
    customStrictnessToggles: [],
    configVersion: 1,
    lastModifiedById: ACTOR_USER_ID,
    lastModifiedAt: new Date('2026-07-17T12:00:00.000Z'),
    createdAt: new Date('2026-07-17T12:00:00.000Z'),
    ...overrides,
  };
}

function configRowWithFullFiscal(overrides?: Partial<Record<string, unknown>>): any {
  return buildMockConfigRow({
    fiscal: { ...FULL_FISCAL },
    ...overrides,
  });
}

function configRowWithEmptyFiscal(overrides?: Partial<Record<string, unknown>>): any {
  return buildMockConfigRow({
    fiscal: { ...EMPTY_FISCAL },
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TenantConfigService', () => {
  let service: TenantConfigService;
  let prisma: DeepMockProxy<PrismaClient>;
  let validationService: jest.Mocked<ConfigValidationService>;

  const COMMON_DTO_PARAMS = {
    expectedConfigVersion: 1,
  };

  beforeEach(() => {
    prisma = mockDeep<PrismaClient>();
    validationService = {
      validate: jest.fn().mockReturnValue([]),
    } as unknown as jest.Mocked<ConfigValidationService>;
    service = new TenantConfigService(prisma as any, validationService);
  });

  // ==========================================================================
  //  update()
  // ==========================================================================

  describe('update', () => {
    // --------------------------------------------------------------------
    //  Fiscal validation scenarios
    // --------------------------------------------------------------------

    describe('fiscal validation guard', () => {
      it('skips fiscal validation on partial update when DB fiscal is empty (initial setup)', async () => {
        const dbRow = configRowWithEmptyFiscal();
        (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValue(dbRow);
        const updatedRow = configRowWithEmptyFiscal({
          configVersion: 2,
          fiscal: { ...EMPTY_FISCAL, companyName: 'Mi Farmacia' },
        });
        (prisma.tenantConfig.update as jest.Mock).mockResolvedValue(updatedRow);

        const result = await service.update(
          SUBSCRIPTION_ID,
          { fiscal: { companyName: 'Mi Farmacia' }, ...COMMON_DTO_PARAMS },
          ACTOR_USER_ID,
          ACTOR_ROLE,
        );

        // Should succeed without ConfigValidationException
        expect(result.fiscal.companyName).toBe('Mi Farmacia');
        // validate must have been called, but the fiscal section must NOT be
        // in the validation input (only strictness and workflow are present)
        const validateCallArgs = validationService.validate.mock.calls[0][0];
        expect(validateCallArgs.fiscal).toBeUndefined();
        expect(prisma.tenantConfig.update).toHaveBeenCalled();
      });

      it('validates merged fiscal on partial update when DB has fully-configured fiscal', async () => {
        const dbRow = configRowWithFullFiscal();
        (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValue(dbRow);
        const updatedRow = configRowWithFullFiscal({
          configVersion: 2,
          fiscal: { ...FULL_FISCAL, companyName: 'Nueva Razón Social' },
        });
        (prisma.tenantConfig.update as jest.Mock).mockResolvedValue(updatedRow);

        const result = await service.update(
          SUBSCRIPTION_ID,
          { fiscal: { companyName: 'Nueva Razón Social' }, ...COMMON_DTO_PARAMS },
          ACTOR_USER_ID,
          ACTOR_ROLE,
        );

        expect(result.fiscal.companyName).toBe('Nueva Razón Social');
        // validate must have been called WITH fiscal in the input
        const validateCallArgs = validationService.validate.mock.calls[0][0];
        expect(validateCallArgs.fiscal).toBeDefined();
        expect(validateCallArgs.fiscal!.companyName).toBe('Nueva Razón Social');
        expect(prisma.tenantConfig.update).toHaveBeenCalled();
      });

      it('validates fiscal when single request provides all required fields on empty DB', async () => {
        const dbRow = configRowWithEmptyFiscal();
        (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValue(dbRow);
        const allFields = {
          companyName: 'Mi Farmacia',
          nit: '123456789',
          address: 'Calle 1 #2-3',
          city: 'Bogotá',
          phone: '6015550000',
          email: 'a@b.com',
          dianResolutionNumber: 'RES-001',
          dianResolutionDate: '2025-06-01',
          dianResolutionPrefix: 'PREFIX',
        };
        const mergedFiscal = { ...EMPTY_FISCAL, ...allFields };
        const updatedRow = configRowWithEmptyFiscal({
          configVersion: 2,
          fiscal: mergedFiscal,
        });
        (prisma.tenantConfig.update as jest.Mock).mockResolvedValue(updatedRow);

        const result = await service.update(
          SUBSCRIPTION_ID,
          { fiscal: allFields, ...COMMON_DTO_PARAMS },
          ACTOR_USER_ID,
          ACTOR_ROLE,
        );

        // Must succeed — mergedFiscal is fully configured so validation runs,
        // and if it passes, the update goes through
        expect(result.fiscal.companyName).toBe('Mi Farmacia');
        const validateCallArgs = validationService.validate.mock.calls[0][0];
        expect(validateCallArgs.fiscal).toBeDefined();
        expect(validateCallArgs.fiscal!.nit).toBe('123456789');
        expect(prisma.tenantConfig.update).toHaveBeenCalled();
      });

      it('throws ConfigValidationException when partial update wipes required field on fully-configured DB', async () => {
        const dbRow = configRowWithFullFiscal();
        (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValue(dbRow);
        // Return validation errors for the empty companyName
        validationService.validate.mockReturnValue([
          {
            path: 'fiscal.companyName',
            message: 'companyName is required and must not be empty',
            code: 'REQUIRED_FIELD_EMPTY',
          },
        ]);

        await expect(
          service.update(
            SUBSCRIPTION_ID,
            { fiscal: { companyName: '' }, ...COMMON_DTO_PARAMS },
            ACTOR_USER_ID,
            ACTOR_ROLE,
          ),
        ).rejects.toThrow(ConfigValidationException);

        // validate must have been called WITH fiscal
        const validateCallArgs = validationService.validate.mock.calls[0][0];
        expect(validateCallArgs.fiscal).toBeDefined();
        // The merged fiscal should have companyName empty
        expect(validateCallArgs.fiscal!.companyName).toBe('');
        // update should NOT be called since validation fails
        expect(prisma.tenantConfig.update).not.toHaveBeenCalled();
      });

      it('does not add fiscal to validation when neither DB nor merged fiscal is fully configured', async () => {
        const dbRow = configRowWithEmptyFiscal();
        (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValue(dbRow);
        const updatedRow = configRowWithEmptyFiscal({
          configVersion: 2,
          fiscal: { ...EMPTY_FISCAL, companyName: 'Partial', nit: '123' },
        });
        (prisma.tenantConfig.update as jest.Mock).mockResolvedValue(updatedRow);

        // Two fields provided but not all 9 — still not fully configured
        await service.update(
          SUBSCRIPTION_ID,
          { fiscal: { companyName: 'Partial', nit: '123' }, ...COMMON_DTO_PARAMS },
          ACTOR_USER_ID,
          ACTOR_ROLE,
        );

        const validateCallArgs = validationService.validate.mock.calls[0][0];
        expect(validateCallArgs.fiscal).toBeUndefined();
      });
    });

    // --------------------------------------------------------------------
    //  Version conflict
    // --------------------------------------------------------------------

    describe('version conflict', () => {
      it('throws ConfigVersionConflictException when expectedConfigVersion does not match', async () => {
        const dbRow = configRowWithEmptyFiscal({ configVersion: 3 });
        (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValue(dbRow);

        await expect(
          service.update(
            SUBSCRIPTION_ID,
            { strictness: { lots: 'STRICT' }, expectedConfigVersion: 1 },
            ACTOR_USER_ID,
            ACTOR_ROLE,
          ),
        ).rejects.toThrow(ConfigVersionConflictException);

        // update should NOT be called — guard fires before any write
        expect(prisma.tenantConfig.update).not.toHaveBeenCalled();
      });
    });

    // --------------------------------------------------------------------
    //  Happy path — no fiscal section in DTO
    // --------------------------------------------------------------------

    describe('without fiscal in DTO', () => {
      it('does not call fiscal validation when DTO omits fiscal entirely', async () => {
        const dbRow = configRowWithEmptyFiscal();
        (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValue(dbRow);
        const updatedRow = configRowWithEmptyFiscal({
          configVersion: 2,
          strictness: { ...FULL_STRICTNESS, lots: 'STRICT' },
        });
        (prisma.tenantConfig.update as jest.Mock).mockResolvedValue(updatedRow);

        await service.update(
          SUBSCRIPTION_ID,
          { strictness: { lots: 'STRICT' }, ...COMMON_DTO_PARAMS },
          ACTOR_USER_ID,
          ACTOR_ROLE,
        );

        const validateCallArgs = validationService.validate.mock.calls[0][0];
        expect(validateCallArgs.fiscal).toBeUndefined();
        // strictness should still be validated
        expect(validateCallArgs.strictness).toBeDefined();
      });
    });
  });

  // ==========================================================================
  //  createDefaultAndUpdate  (exercised via update() when no config exists)
  // ==========================================================================

  describe('createDefaultAndUpdate', () => {
    /**
     * When update() finds no existing config (findUnique returns null), it
     * delegates to the private createDefaultAndUpdate().  These tests verify
     * that fiscal validation is deliberately skipped in that path.
     */

    function mockCreateDefaultFlow() {
      // Step 1 — update() finds no config → triggers createDefaultAndUpdate
      (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // Step 2 — createDefault() inside createDefaultAndUpdate also finds none
      (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValueOnce(null);
      // Step 3 — createDefault() creates the new record
      const created = configRowWithEmptyFiscal({ configVersion: 1 });
      (prisma.tenantConfig.create as jest.Mock).mockResolvedValueOnce(created);
      // Step 4 — changelog entry for creation
      (prisma.configChangelog.create as jest.Mock).mockResolvedValueOnce({} as any);
      // Step 5 — re-fetch before the final update
      (prisma.tenantConfig.findUnique as jest.Mock).mockResolvedValueOnce(created);
      // Step 6 — final update (merging the DTO on top of defaults)
      const updated = configRowWithEmptyFiscal({
        configVersion: 2,
        fiscal: {
          ...EMPTY_FISCAL,
          companyName: 'Mi Farmacia',
          nit: '123456789',
          address: 'Addr',
          city: 'City',
          phone: 'Phone',
          email: 'e@mail.com',
          dianResolutionNumber: 'R001',
          dianResolutionDate: '2025-01-01',
          dianResolutionPrefix: 'PRE',
        },
      });
      (prisma.tenantConfig.update as jest.Mock).mockResolvedValueOnce(updated);
      // Step 7 — changelog for the update
      (prisma.configChangelog.create as jest.Mock).mockResolvedValueOnce({} as any);
    }

    it('skips fiscal validation during initial creation even when all fiscal fields are provided', async () => {
      mockCreateDefaultFlow();

      await service.update(
        SUBSCRIPTION_ID,
        {
          fiscal: {
            companyName: 'Mi Farmacia',
            nit: '123456789',
            address: 'Addr',
            city: 'City',
            phone: 'Phone',
            email: 'e@mail.com',
            dianResolutionNumber: 'R001',
            dianResolutionDate: '2025-01-01',
            dianResolutionPrefix: 'PRE',
          },
          expectedConfigVersion: 0, // ignored by createDefaultAndUpdate
        },
        ACTOR_USER_ID,
        ACTOR_ROLE,
      );

      // Validate was called (for strictness/workflow), but fiscal must NOT
      // be in the validation input
      expect(validationService.validate).toHaveBeenCalled();
      const allCalls = validationService.validate.mock.calls;
      for (const args of allCalls) {
        expect(args[0].fiscal).toBeUndefined();
      }
      // Update must have happened
      expect(prisma.tenantConfig.update).toHaveBeenCalled();
    });

    it('applies fiscal fields to DB during initial creation even though validation is skipped', async () => {
      mockCreateDefaultFlow();

      const result = await service.update(
        SUBSCRIPTION_ID,
        {
          fiscal: {
            companyName: 'Mi Farmacia',
            nit: '123456789',
            address: 'Addr',
            city: 'City',
            phone: 'Phone',
            email: 'e@mail.com',
            dianResolutionNumber: 'R001',
            dianResolutionDate: '2025-01-01',
            dianResolutionPrefix: 'PRE',
          },
          expectedConfigVersion: 0,
        },
        ACTOR_USER_ID,
        ACTOR_ROLE,
      );

      // The resulting TenantConfig should reflect the fiscal fields from the DTO
      expect(result.fiscal.companyName).toBe('Mi Farmacia');
      expect(result.fiscal.nit).toBe('123456789');
      expect(result.fiscal.address).toBe('Addr');
    });
  });
});
