/**
 * SQL-shape tests for the sales report query builders.
 *
 * These assert on the generated SQL text, not on execution: they pin the
 * commission wiring and guard the row-multiplication regression — a JOIN on
 * "SaleItem" inside a Sale-level aggregation would inflate every MONEY_AGGS
 * sum by the number of items per sale.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCashShiftCloseQuery,
  buildCountQuery,
  buildSalesByCashierQuery,
  buildSalesByProductQuery,
  buildSalesDailySummaryQuery,
  endOfDayUtcExclusive,
  startOfDayUtc,
} from './report-query-builders';
import { ReportDatePreset } from './report-types';
import type { DateRangeFilter } from './report-types';

const range: DateRangeFilter = {
  preset: ReportDatePreset.CUSTOM,
  dateFrom: '2026-07-01',
  dateTo: '2026-07-31',
  comparePrevious: false,
};

const pagination = { limit: 20, offset: 0 };

describe('buildSalesDailySummaryQuery', () => {
  it('computes total_commission from a correlated "SaleItem" subquery threaded through the days CTE', () => {
    const { sql } = buildSalesDailySummaryQuery(range, {}, pagination);

    expect(sql).toContain('SELECT COALESCE(SUM(si."commissionAmount"), 0)::numeric');
    expect(sql).toContain('FROM "SaleItem" si');
    expect(sql).toContain('WHERE si."saleId" = s."id"');
    expect(sql).toContain('AS total_commission');
    // One alias in the confirmed CTE, one selection in the days CTE.
    expect(sql.match(/total_commission/g)).toHaveLength(2);
  });

  it('never joins "SaleItem" into the Sale-level aggregation', () => {
    const { sql } = buildSalesDailySummaryQuery(range, {}, pagination);

    expect(sql).not.toMatch(/JOIN\s+"SaleItem"/);
  });

  it('keeps the date range bounds as the first two params', () => {
    const { sql, params } = buildSalesDailySummaryQuery(range, {}, pagination);

    expect(params[0]).toBe(startOfDayUtc(range.dateFrom));
    expect(params[1]).toBe(endOfDayUtcExclusive(range.dateTo));
    expect(sql).toContain('s."confirmedAt" >= $1');
    expect(sql).toContain('s."confirmedAt" < $2');
  });

  it('appends the cashier filter after the date range params', () => {
    const { sql, params } = buildSalesDailySummaryQuery(
      range,
      { cashierUserId: 'user-cashier-01' },
      pagination,
    );

    expect(params[0]).toBe(startOfDayUtc(range.dateFrom));
    expect(params[1]).toBe(endOfDayUtcExclusive(range.dateTo));
    expect(params[2]).toBe('user-cashier-01');
    expect(sql).toContain('s."userId" = $3');
  });
});

describe('buildSalesByCashierQuery', () => {
  it('computes commission_amount from a correlated "SaleItem" subquery exposed in the final SELECT', () => {
    const { sql } = buildSalesByCashierQuery(range, {}, pagination);

    expect(sql).toContain('SELECT COALESCE(SUM(si."commissionAmount"), 0)::numeric');
    expect(sql).toContain('FROM "SaleItem" si');
    expect(sql).toContain('WHERE si."saleId" = s."id"');
    expect(sql).toContain('AS commission_amount');
    expect(sql).toContain('p.commission_amount');
    // One alias in the per_cashier CTE, one reference in the final SELECT.
    expect(sql.match(/commission_amount/g)).toHaveLength(2);
  });

  it('never joins "SaleItem" into the Sale-level aggregation', () => {
    const { sql } = buildSalesByCashierQuery(range, {}, pagination);

    expect(sql).not.toMatch(/JOIN\s+"SaleItem"/);
  });

  it('keeps the date range bounds as the first two params', () => {
    const { sql, params } = buildSalesByCashierQuery(range, {}, pagination);

    expect(params[0]).toBe(startOfDayUtc(range.dateFrom));
    expect(params[1]).toBe(endOfDayUtcExclusive(range.dateTo));
    expect(sql).toContain('s."confirmedAt" >= $1');
    expect(sql).toContain('s."confirmedAt" < $2');
  });
});

describe('buildSalesByProductQuery', () => {
  it('aggregates commission_amount with SUM over the driving "SaleItem" table', () => {
    const { sql } = buildSalesByProductQuery(range, {}, pagination);

    expect(sql).toContain('COALESCE(SUM(si."commissionAmount"), 0)::numeric AS commission_amount');
  });

  it('keeps the date range bounds as the first two params', () => {
    const { sql, params } = buildSalesByProductQuery(range, {}, pagination);

    expect(params[0]).toBe(startOfDayUtc(range.dateFrom));
    expect(params[1]).toBe(endOfDayUtcExclusive(range.dateTo));
    expect(sql).toContain('s."confirmedAt" >= $1');
    expect(sql).toContain('s."confirmedAt" < $2');
  });
});

describe('buildCountQuery', () => {
  it('keeps every param when the base query has no LIMIT/OFFSET tail', () => {
    const base = buildCashShiftCloseQuery('shift-abc');
    const { sql, params } = buildCountQuery(base, 'COUNT(*)', base.params);

    expect(sql).toContain('SELECT COUNT(*) AS total FROM (');
    // Regression pin: the shift filter placeholder stays bound inside the
    // wrapped subquery — previously the last two params were sliced
    // unconditionally, leaving $1 unbound (Postgres error 08P01).
    expect(sql).toContain('WHERE cs."id" = $1');
    expect(params).toEqual(['shift-abc']);
  });

  it('strips only the pagination tail params from a LIMIT/OFFSET query', () => {
    const base = buildSalesByCashierQuery(
      range,
      { restrictToUserId: 'user-cashier-01' },
      { limit: 20, offset: 5 },
    );
    const { sql, params } = buildCountQuery(base, 'COUNT(*)', base.params);

    expect(params).toEqual([
      startOfDayUtc(range.dateFrom),
      endOfDayUtcExclusive(range.dateTo),
      'user-cashier-01',
    ]);
    expect(sql).not.toMatch(/LIMIT\s+\$\d+\s+OFFSET\s+\$\d+\s*$/i);
    expect(sql).toContain('s."userId" = $3');
  });
});
