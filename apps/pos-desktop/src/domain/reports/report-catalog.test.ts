/**
 * Catalog contract tests for the commission columns.
 *
 * Pins the exact column ids, types, alignment, and ordering the table
 * renderer depends on, plus the i18n keys the headers resolve through.
 */
import { describe, expect, it } from 'vitest';
import { getReportDefinition } from './report-catalog';
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
