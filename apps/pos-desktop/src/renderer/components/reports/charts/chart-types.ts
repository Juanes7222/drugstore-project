/**
 * Shared chart type contracts.
 *
 * The execution service emits chart data in a small, framework-free
 * shape; the option factories map it to ECharts option objects.
 */

import type { ReportChartKind } from '../../../../domain/reports/report-types';

export interface ReportChartSeries {
  name: string;
  data: Array<number | string | [number, number, string?, string?]>;
}

export interface ReportChartData {
  kind: ReportChartKind;
  /** Category axis labels (e.g. dates, hours, cashier ids). */
  xAxis?: Array<string | number>;
  /** Series in the order the UI should display them. */
  series: ReportChartSeries[];
}
