/**
 * Catalog contract tests for the commission columns.
 *
 * Pins the exact column ids, types, alignment, and ordering the table
 * renderer depends on, plus the i18n keys the headers resolve through.
 */
import { describe, expect, it } from 'vitest';
import {
  REPORT_CATALOG,
  getReportDefinition,
  listReportsForRole,
  reportConfigSatisfied,
} from './report-catalog';
import { ReportCode, ReportColumnType } from './report-types';
import es from '../../renderer/i18n/locales/es.json';
import en from '../../renderer/i18n/locales/en.json';

const columnIds = (code: ReportCode): string[] =>
  getReportDefinition(code).columns.map((c) => c.id);

const findColumn = (code: ReportCode, id: string) => {
  const column = getReportDefinition(code).columns.find((c) => c.id === id);
  if (!column) {
    throw new Error(`Column "${id}" not found in report ${code}`);
  }
  return column;
};

describe('SALES_DAILY_SUMMARY catalog columns', () => {
  it('ends with totalCommission directly after netSales', () => {
    expect(columnIds(ReportCode.SALES_DAILY_SUMMARY)).toEqual([
      'date',
      'transactionCount',
      'grossSales',
      'discounts',
      'taxes',
      'returns',
      'annulled',
      'netSales',
      'deliveryCount',
      'deliveryFeeCollected',
      'totalCommission',
    ]);
  });

  it('types totalCommission as right-aligned currency', () => {
    expect(findColumn(ReportCode.SALES_DAILY_SUMMARY, 'totalCommission')).toMatchObject({
      type: ReportColumnType.CURRENCY,
      align: 'right',
      titleKey: 'reports.cols.total_commission',
    });
  });
});

describe('SALES_BY_CASHIER catalog columns', () => {
  it('places commissionAmount between netSales and averageTicket', () => {
    expect(columnIds(ReportCode.SALES_BY_CASHIER)).toEqual([
      'cashierName',
      'transactionCount',
      'grossSales',
      'returns',
      'netSales',
      'commissionAmount',
      'averageTicket',
      'totalVariance',
    ]);
  });

  it('types commissionAmount as right-aligned currency', () => {
    expect(findColumn(ReportCode.SALES_BY_CASHIER, 'commissionAmount')).toMatchObject({
      type: ReportColumnType.CURRENCY,
      align: 'right',
      titleKey: 'reports.cols.commission_amount',
    });
  });
});

describe('SALES_BY_PRODUCT catalog columns', () => {
  it('places commissionAmount between netRevenue and contributionPercent', () => {
    expect(columnIds(ReportCode.SALES_BY_PRODUCT)).toEqual([
      'rank',
      'productName',
      'unitsSold',
      'grossRevenue',
      'netRevenue',
      'commissionAmount',
      'contributionPercent',
    ]);
  });

  it('types commissionAmount as right-aligned currency', () => {
    expect(findColumn(ReportCode.SALES_BY_PRODUCT, 'commissionAmount')).toMatchObject({
      type: ReportColumnType.CURRENCY,
      align: 'right',
      titleKey: 'reports.cols.commission_amount',
    });
  });
});

describe('config-gated reports', () => {
  it('INV_EXPIRING_LOTS requires lot tracking on reception', () => {
    expect(getReportDefinition(ReportCode.INV_EXPIRING_LOTS).requiresConfig).toEqual([
      'requireLotOnReception',
    ]);
  });

  it('INV_EXPIRED_WITH_LOSS requires expiry tracking on reception', () => {
    expect(getReportDefinition(ReportCode.INV_EXPIRED_WITH_LOSS).requiresConfig).toEqual([
      'requireExpiryOnReception',
    ]);
  });

  it('reports without requiresConfig are never gated by the config', () => {
    const plain = getReportDefinition(ReportCode.SALES_DAILY_SUMMARY);
    expect(reportConfigSatisfied(plain, undefined)).toBe(true);
    expect(reportConfigSatisfied(plain, { requireLotOnReception: false })).toBe(true);
    expect(reportConfigSatisfied(plain, null)).toBe(true);
  });

  it('hides lot/expiry reports when the purchases config disables them', () => {
    const strict = listReportsForRole('OWNER', {
      requireLotOnReception: true,
      requireExpiryOnReception: true,
    });
    expect(strict.map((r) => r.code)).toContain(ReportCode.INV_EXPIRING_LOTS);
    expect(strict.map((r) => r.code)).toContain(ReportCode.INV_EXPIRED_WITH_LOSS);

    const simple = listReportsForRole('OWNER', {
      requireLotOnReception: false,
      requireExpiryOnReception: false,
    });
    expect(simple.map((r) => r.code)).not.toContain(ReportCode.INV_EXPIRING_LOTS);
    expect(simple.map((r) => r.code)).not.toContain(ReportCode.INV_EXPIRED_WITH_LOSS);
  });

  it('does not gate before the config loads (null context)', () => {
    const all = listReportsForRole('OWNER', null);
    expect(all.map((r) => r.code)).toContain(ReportCode.INV_EXPIRING_LOTS);
    expect(all.map((r) => r.code)).toContain(ReportCode.INV_EXPIRED_WITH_LOSS);
  });
});

describe('removed reports', () => {
  it('no longer ships AUDIT_TRACEABILITY nor FISCAL_DIAN_DOCUMENTS', () => {
    const codes = REPORT_CATALOG.map((r) => r.code);
    expect(codes).not.toContain('AUDIT_TRACEABILITY');
    expect(codes).not.toContain('FISCAL_DIAN_DOCUMENTS');
  });
});

describe('badge columns carry a translation prefix', () => {
  it('INV_MOVEMENTS movementType resolves through reports.movement_types', () => {
    expect(findColumn(ReportCode.INV_MOVEMENTS, 'movementType')).toMatchObject({
      type: ReportColumnType.BADGE,
      badgeKeyPrefix: 'reports.movement_types',
    });
  });

  it('INV_CURRENT_STOCK lowStock resolves through reports.badges.low_stock', () => {
    expect(findColumn(ReportCode.INV_CURRENT_STOCK, 'lowStock')).toMatchObject({
      type: ReportColumnType.BADGE,
      badgeKeyPrefix: 'reports.badges.low_stock',
    });
  });

  it('PROFIT_MARGIN_BY_PRODUCT marginStatus resolves through reports.margins', () => {
    expect(findColumn(ReportCode.PROFIT_MARGIN_BY_PRODUCT, 'marginStatus')).toMatchObject({
      type: ReportColumnType.BADGE,
      badgeKeyPrefix: 'reports.margins',
    });
  });

  it('translates every MovementType key in both locales', () => {
    const keys = [
      'PURCHASE_RECEIPT', 'SALE', 'POSITIVE_ADJUSTMENT', 'NEGATIVE_ADJUSTMENT',
      'CLIENT_RETURN', 'SUPPLIER_RETURN', 'ADMIN_BLOCK', 'ADMIN_UNBLOCK',
      'AUTO_EXPIRATION', 'PHYSICAL_COUNT', 'INITIAL_STOCK',
    ];
    for (const key of keys) {
      expect(typeof (es.reports.movement_types as Record<string, unknown>)[key]).toBe('string');
      expect(typeof (en.reports.movement_types as Record<string, unknown>)[key]).toBe('string');
    }
  });

  it('translates low-stock badges in both locales', () => {
    expect(es.reports.badges.low_stock.true).toBe('Stock bajo');
    expect(es.reports.badges.low_stock.false).toBe('En nivel');
    expect(en.reports.badges.low_stock.true).toBe('Low stock');
    expect(en.reports.badges.low_stock.false).toBe('In stock');
  });
});

describe('i18n contract for commission column headers', () => {
  it('translates reports.cols.total_commission in both locales', () => {
    expect(typeof es.reports.cols.total_commission).toBe('string');
    expect(es.reports.cols.total_commission.length).toBeGreaterThan(0);
    expect(typeof en.reports.cols.total_commission).toBe('string');
    expect(en.reports.cols.total_commission.length).toBeGreaterThan(0);
  });

  it('translates reports.cols.commission_amount in both locales', () => {
    expect(typeof es.reports.cols.commission_amount).toBe('string');
    expect(es.reports.cols.commission_amount.length).toBeGreaterThan(0);
    expect(typeof en.reports.cols.commission_amount).toBe('string');
    expect(en.reports.cols.commission_amount.length).toBeGreaterThan(0);
  });
});
