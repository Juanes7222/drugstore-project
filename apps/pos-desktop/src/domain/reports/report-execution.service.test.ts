/**
 * Report execution service — CASH_SHIFT_CLOSE empty-shiftId guard.
 *
 * The report catalog ships `{ shiftId: '' }` as the CASH_SHIFT_CLOSE
 * default; the Zod schema would reject that sentinel as a generic
 * invalid-filters failure.  The service must surface it as
 * `ReportFiltersNotReadyException` instead, so the UI can prompt for
 * the shift rather than rendering an error state.  Other report codes
 * must never hit the guard.
 */
import { describe, expect, it, vi } from 'vitest';
import { RoleType } from '@pharmacy/shared-types';
import type { PrismaClient } from '@pharmacy/database/local';
import { ReportExecutionService } from './report-execution.service';
import {
  ReportExecutionException,
  ReportFiltersNotReadyException,
  ReportShiftNotFoundException,
} from './exceptions';
import { ReportCode, ReportDatePreset } from './report-types';
import type { LocalSession } from '../auth/local-session.store';

const DEFAULT_MESSAGE_KEY = 'reports.filters.select_shift';

const baseSession: LocalSession = {
  userId: 'user-1',
  username: 'manager',
  fullName: 'Manager User',
  displayName: 'Manager',
  role: RoleType.MANAGER,
  subscriptionId: 'sub-1',
  workstationId: 'ws-1',
  accessToken: '',
  refreshToken: '',
  sessionId: 'session-1',
  sessionTrust: 'SERVER_VERIFIED',
};

// All guard tests fail before any database access; the $queryRawUnsafe
// stub only serves the tests that pass the guard and reach the query
// pipeline (empty result set → ReportShiftNotFoundException).
const createService = (): ReportExecutionService => {
  const prisma = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
  } as unknown as PrismaClient;
  return new ReportExecutionService(prisma);
};

describe('ReportExecutionService', () => {
  describe('run with CASH_SHIFT_CLOSE', () => {
    it('rejects with the default not-ready exception when filters are undefined', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: undefined, session: baseSession }),
      ).rejects.toMatchObject({
        errorCode: 'REPORT_FILTERS_NOT_READY',
        messageKey: DEFAULT_MESSAGE_KEY,
      });
    });

    it('rejects with the default not-ready exception when shiftId is missing', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: {}, session: baseSession }),
      ).rejects.toMatchObject({
        errorCode: 'REPORT_FILTERS_NOT_READY',
        messageKey: DEFAULT_MESSAGE_KEY,
      });
    });

    it('rejects with the default not-ready exception when shiftId is an empty string', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: { shiftId: '' }, session: baseSession }),
      ).rejects.toMatchObject({
        errorCode: 'REPORT_FILTERS_NOT_READY',
        messageKey: DEFAULT_MESSAGE_KEY,
      });
    });

    it('rejects with the default not-ready exception when shiftId is whitespace-only', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: { shiftId: '   ' }, session: baseSession }),
      ).rejects.toMatchObject({
        errorCode: 'REPORT_FILTERS_NOT_READY',
        messageKey: DEFAULT_MESSAGE_KEY,
      });
    });

    it('is not an instance of ReportExecutionException', async () => {
      const service = createService();

      const promise = service.run({
        code: ReportCode.CASH_SHIFT_CLOSE,
        filters: { shiftId: '' },
        session: baseSession,
      });
      await expect(promise).rejects.toBeInstanceOf(ReportFiltersNotReadyException);
      await expect(promise).rejects.not.toBeInstanceOf(ReportExecutionException);
    });

    it('passes the guard for a non-blank shiftId and fails downstream when the shift does not exist', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.CASH_SHIFT_CLOSE, filters: { shiftId: 'shift-1' }, session: baseSession }),
      ).rejects.toBeInstanceOf(ReportShiftNotFoundException);
    });
  });

  describe('run with AUDIT_SHIFT_VARIANCES', () => {
    it('counts every closure (balanced included) and bounds dateTo at end of day', async () => {
      const sqlCalls: Array<{ sql: string; params: unknown[] }> = [];
      const prisma = {
        $queryRawUnsafe: vi.fn().mockImplementation((sql: string, ...params: unknown[]) => {
          sqlCalls.push({ sql, params });
          // Only the KPI aggregate carries the SUM expression.
          if (sql.includes('SUM("closingDifference")')) {
            return Promise.resolve([{ shifts: 3, total: -1200.5 }]);
          }
          return Promise.resolve([]);
        }),
      } as unknown as PrismaClient;
      const service = new ReportExecutionService(prisma);

      const response = await service.run({
        code: ReportCode.AUDIT_SHIFT_VARIANCES,
        filters: {
          preset: ReportDatePreset.CUSTOM,
          dateFrom: '2026-06-01',
          dateTo: '2026-06-30',
          comparePrevious: false,
        },
        session: baseSession,
      });

      const agg = sqlCalls.find((c) => c.sql.includes('SUM("closingDifference")'))!;
      expect(agg.sql).not.toContain('<> 0');
      expect(agg.sql).not.toContain('closingDifference <> 0');
      // The upper bound is end-of-day-exclusive so closures ON the last
      // day of the range (2026-06-30) are not dropped.
      expect(agg.params[0]).toBe('2026-06-01T00:00:00.000Z');
      expect(agg.params[1]).toBe('2026-07-01T00:00:00.000Z');

      expect(response.kpis.map((k) => k.id)).toEqual(
        expect.arrayContaining(['kpi.shifts_closed', 'kpi.total_variance']),
      );
      expect(response.kpis.find((k) => k.id === 'kpi.shifts_closed')!.value).toBe('3');
      expect(response.kpis.find((k) => k.id === 'kpi.total_variance')!.value).toBe('-1200.5');
    });
  });

  describe('run with other report codes', () => {
    it('never applies the guard when filters are invalid', async () => {
      const service = createService();

      await expect(
        service.run({ code: ReportCode.SALES_DAILY_SUMMARY, filters: {}, session: baseSession }),
      ).rejects.toBeInstanceOf(ReportExecutionException);
    });
  });

  describe('config-gated reports', () => {
    it('rejects INV_EXPIRING_LOTS when lot tracking is disabled', async () => {
      const service = createService();

      await expect(
        service.run({
          code: ReportCode.INV_EXPIRING_LOTS,
          filters: { daysAhead: 60 },
          session: baseSession,
          effectiveConfig: { requireLotOnReception: false },
        }),
      ).rejects.toMatchObject({ errorCode: 'REPORT_CONFIG_DISABLED' });
    });

    it('rejects INV_EXPIRED_WITH_LOSS when expiry tracking is disabled', async () => {
      const service = createService();

      await expect(
        service.run({
          code: ReportCode.INV_EXPIRED_WITH_LOSS,
          filters: {},
          session: baseSession,
          effectiveConfig: { requireExpiryOnReception: false },
        }),
      ).rejects.toMatchObject({ errorCode: 'REPORT_CONFIG_DISABLED' });
    });

    it('runs the gated report when the flag is enabled', async () => {
      const prisma = {
        $queryRawUnsafe: vi.fn().mockResolvedValue([
          { expiration_date: '2026-09-10T00:00:00Z', quantity: 5 },
        ]),
      } as unknown as PrismaClient;
      const service = new ReportExecutionService(prisma);

      const res = await service.run({
        code: ReportCode.INV_EXPIRING_LOTS,
        filters: { daysAhead: 60 },
        session: baseSession,
        effectiveConfig: { requireLotOnReception: true },
      });

      expect(res.code).toBe(ReportCode.INV_EXPIRING_LOTS);
      expect(res.rows).toHaveLength(1);
    });

    it('does not gate when no config context is passed (backward compatible)', async () => {
      const service = createService();

      const res = await service.run({
        code: ReportCode.INV_EXPIRING_LOTS,
        filters: { daysAhead: 60 },
        session: baseSession,
      });

      expect(res.code).toBe(ReportCode.INV_EXPIRING_LOTS);
      expect(res.rows).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // Data-concordance chart payloads: the service must not emit mixed-unit
  // series or the wrong axis unit — the renderer trusts these fields.
  // ---------------------------------------------------------------------
  describe('chart payloads (data concordance)', () => {
    const RANGE = {
      preset: 'custom' as const,
      dateFrom: '2026-08-01',
      dateTo: '2026-08-31',
      comparePrevious: false,
    };

    const serviceWithRows = (rows: Record<string, unknown>[]): ReportExecutionService => {
      const prisma = {
        // Every query (data, count, KPI, freshness) receives the same rows;
        // only the data query feeds the chart builders we assert on.
        $queryRawUnsafe: vi.fn().mockResolvedValue(rows),
      } as unknown as PrismaClient;
      return new ReportExecutionService(prisma);
    };

    it('SALES_BY_PRODUCT emits a single currency series with units as secondary', async () => {
      const service = serviceWithRows([
        { product_name: 'Acetaminofén', net_revenue: 1200, units_sold: 3 },
      ]);
      const res = await service.run({
        code: ReportCode.SALES_BY_PRODUCT,
        filters: { ...RANGE, topN: 20 },
        session: baseSession,
      });

      expect(res.chart.kind).toBe('bar_horizontal');
      expect(res.chart.unit).toBe('currency');
      const series = res.chart.series as Array<{ data: Array<{ value: number; secondary?: string }> }>;
      expect(series).toHaveLength(1);
      expect(series[0].data[0]).toMatchObject({
        value: 1200,
        secondary: expect.stringContaining('3'),
      });
    });

    it('INV_EXPIRING_LOTS buckets units by month in a single number series', async () => {
      const service = serviceWithRows([
        { expiration_date: '2026-09-10T00:00:00Z', quantity: 5 },
        { expiration_date: '2026-09-20T00:00:00Z', quantity: 7 },
        { expiration_date: '2026-10-02T00:00:00Z', quantity: 2 },
      ]);
      const res = await service.run({
        code: ReportCode.INV_EXPIRING_LOTS,
        filters: { daysAhead: 60 },
        session: baseSession,
      });

      expect(res.chart.kind).toBe('bar_vertical');
      expect(res.chart.unit).toBe('number');
      expect(res.chart.xAxis).toEqual(['2026-09', '2026-10']);
      const series = res.chart.series as Array<{ data: number[] }>;
      expect(series).toHaveLength(1);
      expect(series[0].data).toEqual([12, 2]);
    });

    it('INV_ROTATION carries ratio/number scatter axes instead of percent/COP', async () => {
      const service = serviceWithRows([
        { rotation_index: 2.5, units_sold: 40, product_name: 'B' },
      ]);
      const res = await service.run({
        code: ReportCode.INV_ROTATION,
        filters: RANGE,
        session: baseSession,
      });

      expect(res.chart.scatterAxes).toEqual({
        x: { label: expect.any(String), unit: 'ratio' },
        y: { label: expect.any(String), unit: 'number' },
      });
      expect(res.chart.xAxis).toEqual([2.5]);
    });

    it('SALES_BY_WEEKDAY marks its currency amounts', async () => {
      const service = serviceWithRows([{ weekday: 1, total_amount: 5000 }]);
      const res = await service.run({
        code: ReportCode.SALES_BY_WEEKDAY,
        filters: RANGE,
        session: baseSession,
      });

      expect(res.chart.unit).toBe('currency');
    });

    it('INV_STOCK_BY_CATEGORY emits a currency donut of category values', async () => {
      const service = serviceWithRows([
        { category_name: 'Analgésicos', stock_value: 850_000, stock: 12 },
        { category_name: 'Vitaminas', stock_value: 420_000, stock: 8 },
      ]);
      const res = await service.run({
        code: ReportCode.INV_STOCK_BY_CATEGORY,
        filters: {},
        session: baseSession,
      });

      expect(res.chart.kind).toBe('donut');
      expect(res.chart.unit).toBe('currency');
      const series = res.chart.series as Array<{
        data: Array<{ name: string; value: number }>;
      }>;
      expect(series).toHaveLength(1);
      expect(series[0].data).toEqual([
        { name: 'Analgésicos', value: 850_000 },
        { name: 'Vitaminas', value: 420_000 },
      ]);
    });

    it('INV_STOCK_BY_CATEGORY caps the donut at 8 slices and folds the tail into Others', async () => {
      // Production orders by stock_value DESC, so the top 8 are the
      // largest and the tail holds the smallest categories.
      const rows = Array.from({ length: 12 }, (_, i) => ({
        category_name: `Cat-${i + 1}`,
        stock_value: (12 - i) * 100_000,
        stock: 1,
      }));
      const service = serviceWithRows(rows);
      const res = await service.run({
        code: ReportCode.INV_STOCK_BY_CATEGORY,
        filters: {},
        session: baseSession,
      });

      const series = res.chart.series as Array<{ data: Array<{ name: string; value: number }> }>;
      expect(series[0].data).toHaveLength(9); // 8 + Otros
      const others = series[0].data[8];
      expect(others.name).toBe('Otros');
      // Tail = the 4 smallest categories → 1+2+3+4 = 10 (×100.000).
      expect(others.value).toBe(1_000_000);
    });

    it('INV_MOVEMENTS translates MovementType series names through the translate fn', async () => {
      const service = serviceWithRows([
        { created_at: '2026-08-01T10:00:00Z', movement_type: 'SALE', quantity: 3 },
        { created_at: '2026-08-01T11:00:00Z', movement_type: 'SALE', quantity: 2 },
        { created_at: '2026-08-02T09:00:00Z', movement_type: 'PURCHASE_RECEIPT', quantity: 8 },
      ]);
      const t = (key: string, fallback?: string) =>
        key === 'reports.movement_types.SALE' ? 'Venta' : (fallback ?? key);
      const res = await service.run({
        code: ReportCode.INV_MOVEMENTS,
        filters: RANGE,
        session: baseSession,
        t,
      });

      expect(res.chart.kind).toBe('stacked_bar');
      const series = res.chart.series as Array<{ name: string; data: number[] }>;
      expect(series.map((s) => s.name)).toEqual(['Venta', 'PURCHASE_RECEIPT']);
      expect(series[0].data).toEqual([5, 0]);
    });

    it('INV_MOVEMENTS falls back to the raw enum value when no translate fn is provided', async () => {
      const service = serviceWithRows([
        { created_at: '2026-08-01T10:00:00Z', movement_type: 'SALE', quantity: 1 },
      ]);
      const res = await service.run({
        code: ReportCode.INV_MOVEMENTS,
        filters: RANGE,
        session: baseSession,
      });

      const series = res.chart.series as Array<{ name: string }>;
      expect(series[0].name).toBe('SALE');
    });

    it('PROFIT_MARGIN_BY_PRODUCT emits a margin-bracket histogram instead of a scatter', async () => {
      const service = serviceWithRows([
        { gross_margin_percent: -5, gross_profit: -1000 },
        { gross_margin_percent: 4, gross_profit: 200 },
        { gross_margin_percent: 7, gross_profit: 300 },
        { gross_margin_percent: 15, gross_profit: 500 },
        { gross_margin_percent: 35, gross_profit: 900 },
      ]);
      const res = await service.run({
        code: ReportCode.PROFIT_MARGIN_BY_PRODUCT,
        filters: { ...RANGE, lowMarginPercent: 5 },
        session: baseSession,
      });

      expect(res.chart.kind).toBe('bar_vertical');
      expect(res.chart.unit).toBe('number');
      const series = res.chart.series as Array<{ data: number[] }>;
      // Buckets derived from low=5: <0=1, 0-5=1 (4), 5-10=1 (7),
      // 10-15=0, >15=2 (15 and 35).
      expect(series[0].data).toEqual([1, 1, 1, 0, 2]);
      expect(res.chart.xAxis).toEqual(['Pérdida', '0–5%', '5%–10%', '10%–15%', '>15%']);
    });
  });
});
