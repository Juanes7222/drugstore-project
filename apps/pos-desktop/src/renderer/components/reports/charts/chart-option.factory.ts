/**
 * ECharts option factories.
 *
 * Pure functions: each takes the chart data shape produced by the
 * execution service and returns a fully-formed ECharts `EChartsOption`.
 * No side effects, no React.  This keeps the chart configuration
 * testable in isolation and prevents option construction from leaking
 * into page components.
 *
 * Every builder accepts an optional `locale` (default `'es-CO'`) so
 * callers can pass the current i18n language — stops dates appearing
 * in English when the UI is in Spanish and vice‑versa.
 */

import type { EChartsOption } from 'echarts';
import { reportChartTheme, type ReportChartTheme } from './chart-theme';
import type { ReportChartData } from './chart-types';

/** Labels that ECharts needs at build time (axis names, tooltip
 *  prefixes, screen‑reader summary).  Components that use these
 *  factories should pass translated values from i18n. */
export interface ChartLabels {
  /** Y-axis label on profit-margin scatter (default "Margen (%)"). */
  scatterMargin?: string;
  /** X-axis label on profit-margin scatter (default "Utilidad (COP)"). */
  scatterProfit?: string;
  /** Tooltip prefix for margin (default "Margen: "). */
  tooltipMargin?: string;
  /** Tooltip prefix for profit (default "<br/>Utilidad: "). */
  tooltipProfit?: string;
  /** Summary prefix when data has named categories (default
   *  "Distribución con {count} categorías. Total: {total}."). */
  summaryDistribution?: string;
  /** Summary prefix for numeric data (default
   *  "{count} puntos, total {total}, promedio {avg}."). */
  summaryNumeric?: string;
}

const DEFAULT_LABELS: Required<ChartLabels> = {
  scatterMargin: 'Margen (%)',
  scatterProfit: 'Utilidad (COP)',
  tooltipMargin: 'Margen: ',
  tooltipProfit: '<br/>Utilidad: ',
  summaryDistribution: 'Distribución con {count} categorías. Total: {total}.',
  summaryNumeric: '{count} puntos, total {total}, promedio {avg}.',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create locale-aware formatters. */
function fmt(locale: string) {
  return {
    COP: new Intl.NumberFormat(locale, { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }),
    INT: new Intl.NumberFormat(locale),
    PCT: new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }),
    HOUR: new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
  };
}

const baseOption = (theme: ReportChartTheme): Partial<EChartsOption> => ({
  color: theme.series,
  backgroundColor: 'transparent',
  textStyle: { color: theme.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' },
  legend: { textStyle: { color: theme.textMuted } },
  tooltip: {
    trigger: 'axis',
    backgroundColor: '#FFFFFF',
    borderColor: theme.border,
    textStyle: { color: theme.textPrimary, fontSize: 12 },
  },
  grid: { left: 56, right: 32, top: 40, bottom: 48, containLabel: true },
});

export function buildLineOption(
  data: ReportChartData,
  withDataZoom = true,
  locale = 'es-CO',
): EChartsOption {
  const theme = reportChartTheme;
  const f = fmt(locale);
  return {
    ...baseOption(theme),
    xAxis: {
      type: 'category',
      data: data.xAxis ?? [],
      axisLine: { lineStyle: { color: theme.border } },
      axisLabel: { color: theme.textMuted },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
      axisLabel: { color: theme.textMuted, formatter: (v: number) => f.COP.format(v) },
    },
    series: data.series.map((s, idx) => ({
      name: s.name,
      type: 'line',
      smooth: true,
      showSymbol: false,
      data: s.data,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.08, color: theme.series[idx % theme.series.length] },
    })),
    dataZoom: withDataZoom ? [{ type: 'inside' }, { type: 'slider', height: 18 }] : undefined,
  } as EChartsOption;
}

export function buildAreaOption(data: ReportChartData, locale = 'es-CO'): EChartsOption {
  return buildLineOption(data, true, locale);
}

export function buildBarHorizontalOption(data: ReportChartData, locale = 'es-CO'): EChartsOption {
  const theme = reportChartTheme;
  const f = fmt(locale);
  return {
    ...baseOption(theme),
    legend: { ...baseOption(theme).legend, show: data.series.length > 1 },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
      axisLabel: { color: theme.textMuted, formatter: (v: number) => f.INT.format(v) },
    },
    yAxis: {
      type: 'category',
      data: data.xAxis ?? [],
      axisLine: { lineStyle: { color: theme.border } },
      axisLabel: { color: theme.textMuted },
    },
    series: data.series.map((s, idx) => ({
      name: s.name,
      type: 'bar',
      data: s.data,
      itemStyle: { color: theme.series[idx % theme.series.length], borderRadius: [0, 4, 4, 0] },
    })),
    dataZoom: [{ type: 'slider', yAxisIndex: 0, right: 8, width: 12 }],
  } as EChartsOption;
}

export function buildBarVerticalOption(data: ReportChartData, locale = 'es-CO'): EChartsOption {
  const theme = reportChartTheme;
  const f = fmt(locale);
  return {
    ...baseOption(theme),
    xAxis: {
      type: 'category',
      data: data.xAxis ?? [],
      axisLine: { lineStyle: { color: theme.border } },
      axisLabel: { color: theme.textMuted },
    },
    yAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
      axisLabel: { color: theme.textMuted, formatter: (v: number) => f.INT.format(v) },
    },
    series: data.series.map((s, idx) => ({
      name: s.name,
      type: 'bar',
      data: s.data,
      itemStyle: { color: theme.series[idx % theme.series.length], borderRadius: [4, 4, 0, 0] },
      barMaxWidth: 36,
    })),
  } as EChartsOption;
}

export function buildStackedBarOption(data: ReportChartData, locale = 'es-CO'): EChartsOption {
  return {
    ...buildBarVerticalOption(data, locale),
    series: data.series.map((s, idx) => ({
      ...s,
      type: 'bar',
      stack: 'total',
      itemStyle: { color: reportChartTheme.series[idx % reportChartTheme.series.length] },
    })),
  } as EChartsOption;
}

export function buildDonutOption(data: ReportChartData, locale = 'es-CO'): EChartsOption {
  const theme = reportChartTheme;
  const f = fmt(locale);
  const first = data.series[0];
  const rawData = first?.data;
  const pieData = Array.isArray(rawData)
    ? (rawData as ReadonlyArray<number | string | { name: string; value: number }>).map((d, i) => {
        if (typeof d === 'object' && d !== null) {
          const obj = d as { name: string; value: number };
          return { name: obj.name, value: obj.value };
        }
        return { name: String(data.xAxis?.[i] ?? i), value: Number(d) };
      })
    : [];
  return {
    color: theme.series,
    backgroundColor: 'transparent',
    textStyle: { color: theme.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' },
    legend: { bottom: 0, textStyle: { color: theme.textMuted } },
    tooltip: {
      trigger: 'item',
      backgroundColor: '#FFFFFF',
      borderColor: theme.border,
      formatter: (params) => {
        const p = params as { name: string; value: number; percent: number };
        return `<b>${p.name}</b><br/>${f.COP.format(p.value)} (${p.percent.toFixed(1)}%)`;
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '78%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: theme.surface, borderWidth: 2 },
        label: { color: theme.textPrimary, formatter: '{b}: {d}%' },
        data: pieData,
      },
    ],
  } as EChartsOption;
}

export function buildScatterOption(
  data: ReportChartData,
  locale = 'es-CO',
  labels?: ChartLabels,
): EChartsOption {
  const theme = reportChartTheme;
  const f = fmt(locale);
  const l = { ...DEFAULT_LABELS, ...labels };
  return {
    ...baseOption(theme),
    legend: { ...baseOption(theme).legend, show: false },
    xAxis: {
      type: 'value',
      name: l.scatterMargin,
      nameLocation: 'middle',
      nameGap: 24,
      nameTextStyle: { color: theme.textMuted },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
      axisLabel: { color: theme.textMuted, formatter: (v: number) => `${v.toFixed(1)}%` },
    },
    yAxis: {
      type: 'value',
      name: l.scatterProfit,
      nameLocation: 'middle',
      nameGap: 48,
      nameTextStyle: { color: theme.textMuted },
      axisLine: { show: false },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
      axisLabel: { color: theme.textMuted, formatter: (v: number) => f.COP.format(v) },
    },
    series: data.series.map((s, idx) => ({
      name: s.name,
      type: 'scatter',
      symbolSize: 12,
      data: s.data,
      itemStyle: { color: theme.series[idx % theme.series.length], opacity: 0.75 },
      emphasis: { focus: 'series' },
    })),
    tooltip: {
      trigger: 'item',
      formatter: (params) => {
        const p = params as unknown as { data: [number, number, number?, string?] };
        const name = p.data[3] ?? `${p.data[0]?.toFixed(1)}%`;
        return `<b>${name}</b><br/>${l.tooltipMargin}${p.data[0]?.toFixed(1)}%${l.tooltipProfit}${f.COP.format(p.data[1] ?? 0)}`;
      },
    },
  } as EChartsOption;
}

export function buildDivergingBarOption(data: ReportChartData, locale = 'es-CO'): EChartsOption {
  const theme = reportChartTheme;
  const f = fmt(locale);
  return {
    ...baseOption(theme),
    legend: { ...baseOption(theme).legend, show: false },
    xAxis: {
      type: 'value',
      axisLine: { show: false },
      splitLine: { lineStyle: { color: theme.border, type: 'dashed' } },
      axisLabel: { color: theme.textMuted, formatter: (v: number) => f.COP.format(v) },
    },
    yAxis: {
      type: 'category',
      data: data.xAxis ?? [],
      axisLine: { lineStyle: { color: theme.border } },
      axisLabel: { color: theme.textMuted },
    },
    series: data.series.map((s) => ({
      name: s.name,
      type: 'bar',
      data: (s.data as number[]).map((v) => ({
        value: v,
        itemStyle: { color: v >= 0 ? theme.positive : theme.danger, borderRadius: [0, 4, 4, 0] },
      })),
    })),
  } as EChartsOption;
}

export function buildGaugeOption(value: number, max: number, label: string, locale = 'es-CO'): EChartsOption {
  const theme = reportChartTheme;
  const f = fmt(locale);
  return {
    color: theme.series,
    backgroundColor: 'transparent',
    textStyle: { color: theme.textPrimary, fontFamily: 'Inter, system-ui, sans-serif' },
    series: [
      {
        type: 'gauge',
        progress: { show: true, width: 18 },
        axisLine: { lineStyle: { width: 18, color: [[1, theme.border]] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: theme.textMuted, fontSize: 10 },
        anchor: { show: false },
        title: { show: true, color: theme.textMuted, fontSize: 12, offsetCenter: [0, '70%'] },
        detail: {
          valueAnimation: true,
          color: theme.textPrimary,
          fontSize: 24,
          offsetCenter: [0, '5%'],
          formatter: (val: number) => f.INT.format(val),
        },
        data: [{ value, name: label }],
        max,
      },
    ],
  } as EChartsOption;
}

/** Build a textual summary for a chart — used by screen readers and the
 *  `chart_alt` slot in the viewer.
 *
 *  `labels` can provide translated template strings; otherwise Spanish
 *  defaults are used. */
export function buildChartSummary(
  data: ReportChartData,
  locale = 'es-CO',
  labels?: ChartLabels,
): string {
  if (!data.series.length) return '';
  const f = fmt(locale);
  const l = { ...DEFAULT_LABELS, ...labels };
  const first = data.series[0];
  if (typeof first.data[0] === 'object') {
    const total = (first.data as ReadonlyArray<unknown>).reduce<number>(
      (acc, d) => acc + Number((d as { value?: number }).value ?? 0),
      0,
    );
    return l.summaryDistribution
      .replace('{count}', String(first.data.length))
      .replace('{total}', f.COP.format(total));
  }
  const nums = first.data as ReadonlyArray<number>;
  if (!nums.length) return '';
  const total = nums.reduce((acc: number, v) => acc + Number(v), 0);
  const avg = total / nums.length;
  return l.summaryNumeric
    .replace('{count}', String(nums.length))
    .replace('{total}', f.COP.format(total))
    .replace('{avg}', f.COP.format(avg));
}

// Re-export for external use (e.g. simple formatting without building an option).
export type { ReportChartData };
