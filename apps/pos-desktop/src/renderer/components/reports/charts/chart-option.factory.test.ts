/**
 * Chart option factory — unit-aware formatting and data concordance.
 *
 * Pins the fixes that keep charts honest:
 *  - currency series format axes with COP, count series with integers;
 *  - bar tooltips append the per-item `secondary` label (units on a
 *    revenue bar) without mixing units on the axis;
 *  - the scatter honours per-report axis labels/units (rotation), and
 *    falls back to the profit-margin defaults otherwise;
 *  - donut/summary totals follow the chart unit instead of always COP.
 */
import { describe, expect, it } from 'vitest';
import {
  buildBarHorizontalOption,
  buildBarVerticalOption,
  buildChartSummary,
  buildDivergingBarOption,
  buildDonutOption,
  buildLineOption,
  buildScatterOption,
} from './chart-option.factory';
import type { ReportChartBarItem, ReportChartData } from './chart-types';

const LOCALE = 'es-CO';

interface OptionPieces {
  xAxis?: { axisLabel?: { formatter?: (v: number) => string } };
  yAxis?: { axisLabel?: { formatter?: (v: number) => string } };
  tooltip?: { formatter?: (params: unknown) => string };
}

const pieces = (option: unknown): OptionPieces =>
  option as unknown as OptionPieces;

const barData = (
  unit: ReportChartData['unit'],
  item?: ReportChartBarItem | number,
): ReportChartData => ({
  kind: 'bar_vertical',
  unit,
  xAxis: ['A'],
  series: [{ name: 'Ingresos netos', data: [item ?? 1200] }],
});

describe('bar axis formatting by unit', () => {
  it('formats currency axes with COP', () => {
    const y = pieces(buildBarVerticalOption(barData('currency'), LOCALE)).yAxis!;
    expect(y.axisLabel!.formatter!(1500000)).toContain('$');
    expect(y.axisLabel!.formatter!(1500000)).toContain('1.500.000');
  });

  it('formats number axes as plain integers without a currency symbol', () => {
    const y = pieces(buildBarVerticalOption(barData('number'), LOCALE)).yAxis!;
    expect(y.axisLabel!.formatter!(1500000)).toBe('1.500.000');
    expect(y.axisLabel!.formatter!(1500000)).not.toContain('$');
  });

  it('applies the same unit to horizontal bar axes', () => {
    const x = pieces(
      buildBarHorizontalOption(
        { ...barData('currency'), kind: 'bar_horizontal' },
        LOCALE,
      ),
    ).xAxis!;
    expect(x.axisLabel!.formatter!(200000)).toContain('$');
  });
});

describe('bar tooltip secondary label', () => {
  it('appends the secondary label below the formatted value', () => {
    const data = barData('currency', { value: 1200, secondary: '3 unds' });
    const tip = pieces(buildBarVerticalOption(data, LOCALE)).tooltip!;
    const html = tip.formatter!([
      { name: 'A', seriesName: 'Ingresos netos', value: 1200, data: { value: 1200, secondary: '3 unds' } },
    ]) as string;
    expect(html).toContain('3 unds');
    expect(html).toContain('$');
  });
});

describe('scatter axes', () => {
  it('uses the report-provided axis labels and units (rotation)', () => {
    const data: ReportChartData = {
      kind: 'scatter',
      scatterAxes: {
        x: { label: 'Índice de rotación', unit: 'ratio' },
        y: { label: 'Unidades vendidas', unit: 'number' },
      },
      series: [{ name: 'products', data: [[2.5, 40, 'B']] }],
    };
    const opt = pieces(buildScatterOption(data, LOCALE)).xAxis!;
    expect(opt.axisLabel!.formatter!(2.5)).toBe('2.50');
    expect(opt.axisLabel!.formatter!(2.5)).not.toContain('%');
  });

  it('falls back to profit-margin percent/COP defaults without axes', () => {
    const data: ReportChartData = {
      kind: 'scatter',
      series: [{ name: 'products', data: [[12.3, 5000, 'A']] }],
    };
    const opt = pieces(buildScatterOption(data, LOCALE));
    expect(opt.xAxis!.axisLabel!.formatter!(12.3)).toBe('12.3%');
    expect(opt.yAxis!.axisLabel!.formatter!(5000)).toContain('$');
  });
});

describe('line currency default and diverging bar tooltip', () => {
  it('keeps the currency default for line/area y-axes', () => {
    const y = pieces(
      buildLineOption(
        {
          kind: 'line',
          xAxis: ['2026-08-01'],
          series: [{ name: 'Ventas netas', data: [1500000] }],
        },
        true,
        LOCALE,
      ),
    ).yAxis!;
    expect(y.axisLabel!.formatter!(1500000)).toContain('$');
  });

  it('formats diverging bars as currency in the tooltip', () => {
    const tip = pieces(
      buildDivergingBarOption(
        {
          kind: 'diverging_bar',
          xAxis: ['Cajero A'],
          series: [{ name: 'Diferencia', data: [-50000] }],
        },
        LOCALE,
      ),
    ).tooltip!;
    const html = tip.formatter!([
      { name: 'Cajero A', seriesName: 'Diferencia', data: { value: -50000, itemStyle: {} } },
    ]) as string;
    expect(html).toContain('$');
    expect(html).toContain('50.000');
  });
});

describe('donut unit formatting', () => {
  it('formats count donuts as integers, not COP', () => {
    const data: ReportChartData = {
      kind: 'donut',
      unit: 'number',
      series: [{ name: 'Estados', data: [{ name: 'OK', value: 5 }] }],
    };
    const tip = pieces(buildDonutOption(data, LOCALE)).tooltip!;
    const html = tip.formatter!({ name: 'OK', value: 5, percent: 42 }) as string;
    expect(html).toContain('5');
    expect(html).not.toContain('$');
  });
});

describe('chart summary unit formatting', () => {
  it('sums count charts without a currency symbol', () => {
    const data: ReportChartData = {
      kind: 'bar_vertical',
      unit: 'number',
      series: [{ name: 'units', data: [3, 5] }],
    };
    const summary = buildChartSummary(data, LOCALE);
    expect(summary).toContain('total 8');
    expect(summary).not.toContain('$');
  });

  it('keeps COP for currency charts', () => {
    const data: ReportChartData = {
      kind: 'bar_vertical',
      unit: 'currency',
      series: [{ name: 'net', data: [1000, 2000] }],
    };
    expect(buildChartSummary(data, LOCALE)).toContain('$');
  });
});
