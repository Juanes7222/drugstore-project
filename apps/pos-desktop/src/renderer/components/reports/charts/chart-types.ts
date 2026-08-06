/**
 * Shared chart type contracts.
 *
 * The execution service emits chart data in a small, framework-free
 * shape; the option factories map it to ECharts option objects.
 */

import type {
  ReportChartAxisUnit,
  ReportChartKind,
} from '../../../../domain/reports/report-types';

/**
 * A numeric bar item may carry a pre-formatted `secondary` label that
 * the tooltip appends below the value — e.g. the units sold on top of a
 * revenue bar, or the value at risk on a units bar.  This keeps two
 * dimensions visible without ever mixing units on the axis.
 */
export interface ReportChartBarItem {
  value: number;
  secondary?: string;
}

/** A named slice emitted by donut charts. */
export interface ReportChartDonutSlice {
  name: string;
  value: number;
}

export interface ReportChartSeries {
  name: string;
  data: Array<
    | number
    | string
    | [number, number, string?, string?]
    | ReportChartBarItem
    | ReportChartDonutSlice
  >;
}

export interface ReportChartScatterAxes {
  x: { label: string; unit: 'percent' | 'number' | 'ratio' };
  y: { label: string; unit: 'currency' | 'number' };
}

export interface ReportChartData {
  kind: ReportChartKind;
  /** Category axis labels (e.g. dates, hours, cashier ids). */
  xAxis?: Array<string | number>;
  /** Series in the order the UI should display them. */
  series: ReportChartSeries[];
  /** Numeric unit of the series values — drives axis/tooltip formatting. */
  unit?: ReportChartAxisUnit;
  /** Per-axis scatter config; profit-margin defaults when absent. */
  scatterAxes?: ReportChartScatterAxes;
}
