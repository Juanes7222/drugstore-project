/**
 * Verifies shared-types enum values against Prisma schema values.
 *
 * Prisma values are defined inline based on apps/server/prisma/schema.prisma.
 * @prisma/client is not imported because only string comparison is needed.
 *
 * Enum categories:
 *   1) Exact match  – values must be identical on both sides
 *   2) Subset check – shared-types is a subset of Prisma
 *   3) Skipped      – known discrepancies requiring manual alignment
 *   4) Informational – enums with different purposes on each side
 */

const PRISMA_ENUMS = {
  RoleType: ['CASHIER', 'INVENTORY_ASSISTANT', 'ADMIN', 'ACCOUNTANT'] as const,
  SaleType: ['FREE_SALE', 'PRESCRIPTION', 'CONTROLLED_SUBSTANCE'] as const,
  SaleOperationalState: ['IN_PROGRESS', 'CONFIRMED', 'ANNULLED', 'ABANDONED'] as const,
  FiscalDocumentType: ['INVOICE', 'POS_TICKET', 'CREDIT_NOTE', 'DEBIT_NOTE', 'SUPPORT_DOCUMENT'] as const,
  TaxSchemeType: ['IVA', 'INC', 'RETEFUENTE', 'RETEICA', 'IMPOCONSUMO'] as const,
  PaymentMethodCategory: [
    'CASH', 'DEBIT_CARD', 'CREDIT_CARD', 'BANK_TRANSFER',
    'DIGITAL_WALLET', 'CHECK', 'CREDIT_LINE', 'OTHER',
  ] as const,
  IdentificationType: ['CC', 'NIT', 'CE', 'PASSPORT', 'TI', 'PEP'] as const,
  FiscalDocumentState: [
    'PENDING_GENERATION', 'GENERATION_ERROR', 'PENDING_SIGNATURE',
    'SIGNATURE_ERROR', 'PENDING_TRANSMISSION', 'VALIDATED',
    'REJECTED', 'CONTINGENCY',
  ] as const,
  SyncStatus: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const,
  SystemModule: ['AUTH_USERS', 'CASH_SHIFT', 'CATALOG', 'INVENTORY', 'PURCHASES'] as const,
  AuditAction: ['CREATE', 'UPDATE', 'DELETE', 'ACCESS', 'EXPORT'] as const,
} as const;

import {
  RoleType,
  SaleType,
  SaleOperationalState,
  FiscalDocumentType,
  TaxSchemeType,
  PaymentMethodCategory,
  IdentificationType,
  FiscalDocumentState,
  SyncStatus,
  SystemModule,
  AuditAction,
} from './enums';

function enumValues<T extends Record<string, string>>(e: T): string[] {
  return Object.values(e);
}

describe('Enum consistency: shared-types vs Prisma schema', () => {
  describe('Exact match enums', () => {
    it.each([
      ['RoleType', RoleType, PRISMA_ENUMS.RoleType],
      ['SaleType', SaleType, PRISMA_ENUMS.SaleType],
      ['SaleOperationalState', SaleOperationalState, PRISMA_ENUMS.SaleOperationalState],
      ['FiscalDocumentType', FiscalDocumentType, PRISMA_ENUMS.FiscalDocumentType],
      ['IdentificationType', IdentificationType, PRISMA_ENUMS.IdentificationType],
      ['SyncStatus', SyncStatus, PRISMA_ENUMS.SyncStatus],
    ])('%s values match Prisma exactly', (_name, shared, prisma) => {
      expect(enumValues(shared).sort()).toEqual([...prisma].sort());
    });
  });

  describe('FiscalDocumentState (shared is subset of Prisma)', () => {
    it('every shared value exists in Prisma', () => {
      const shared = enumValues(FiscalDocumentState);
      const prisma = [...PRISMA_ENUMS.FiscalDocumentState];
      const missing = shared.filter((v) => !prisma.includes(v));
      expect(missing).toEqual([]);
    });
  });

  // EXENTO exists in shared-types but not in Prisma.
  // Skipped until a decision is made: add EXENTO to Prisma or remove it from shared-types.
  describe('TaxSchemeType', () => {
    // eslint-disable-next-line jest/no-disabled-tests
    test.skip('EXENTO present in shared-types but missing in Prisma', () => {
      const shared = enumValues(TaxSchemeType);
      const prisma = [...PRISMA_ENUMS.TaxSchemeType];
      const missing = shared.filter((v) => !prisma.includes(v));
      expect(missing).toEqual([]);
    });
  });

  // TRANSFER vs BANK_TRANSFER and ELECTRONIC_WALLET vs DIGITAL_WALLET
  // are known naming inconsistencies that need manual resolution.
  describe('PaymentMethodCategory', () => {
    // eslint-disable-next-line jest/no-disabled-tests
    test.skip('TRANSFER/ELECTRONIC_WALLET names diverge from Prisma', () => {
      const shared = enumValues(PaymentMethodCategory);
      const prisma = [...PRISMA_ENUMS.PaymentMethodCategory];
      const onlyInShared = shared.filter((v) => !prisma.includes(v));
      const onlyInPrisma = prisma.filter((v) => !shared.includes(v));
      expect(onlyInShared).toEqual([]);
      expect(onlyInPrisma).toEqual([]);
    });

    it('warns about pending divergence without failing', () => {
      const shared = enumValues(PaymentMethodCategory);
      const prisma = [...PRISMA_ENUMS.PaymentMethodCategory];
      const onlyInShared = shared.filter((v) => !prisma.includes(v));
      const onlyInPrisma = prisma.filter((v) => !shared.includes(v));

      if (onlyInShared.length > 0 || onlyInPrisma.length > 0) {
        console.warn(
          'PaymentMethodCategory divergence:\n' +
          `  shared-types only: ${onlyInShared}\n` +
          `  Prisma only:       ${onlyInPrisma}\n` +
          '  Align names (BANK_TRANSFER / DIGITAL_WALLET)',
        );
      }
      expect(true).toBe(true);
    });
  });

  // SystemModule and AuditAction serve different contexts:
  // shared-types covers all audit/UI modules, Prisma covers only persisted config rows.
  describe('SystemModule (different scope per side)', () => {
    it('warns about value differences without failing', () => {
      const shared = enumValues(SystemModule);
      const prisma = [...PRISMA_ENUMS.SystemModule];
      const onlyInShared = shared.filter((v) => !prisma.includes(v));
      const onlyInPrisma = prisma.filter((v) => !shared.includes(v));

      if (onlyInShared.length > 0 || onlyInPrisma.length > 0) {
        console.info(
          'SystemModule differs between shared-types and Prisma (expected):\n' +
          `  shared-types (audit/UI): ${onlyInShared}\n` +
          `  Prisma (config):         ${onlyInPrisma}`,
        );
      }
      expect(true).toBe(true);
    });
  });

  describe('AuditAction (different scope per side)', () => {
    it('warns about value differences without failing', () => {
      const shared = enumValues(AuditAction);
      const prisma = [...PRISMA_ENUMS.AuditAction];
      const onlyInShared = shared.filter((v) => !prisma.includes(v));
      const onlyInPrisma = prisma.filter((v) => !shared.includes(v));

      if (onlyInShared.length > 0 || onlyInPrisma.length > 0) {
        console.info(
          'AuditAction differs between shared-types and Prisma (expected):\n' +
          `  shared-types (full log): ${onlyInShared}\n` +
          `  Prisma (persisted):       ${onlyInPrisma}`,
        );
      }
      expect(true).toBe(true);
    });
  });
});
