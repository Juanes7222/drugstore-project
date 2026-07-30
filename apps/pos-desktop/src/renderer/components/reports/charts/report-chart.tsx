/**
 * Reusable chart component for the local reports module.
 *
 * Wraps `echarts-for-react` with the report theme, an `aria` config and
 * a text-summary fallback.  Components never build chart options
 * inline; they pass the framework-free `ReportChartData` shape and the
 * factory here renders the ECharts option.
 *
 * Chart-click → table filter events bubble up via the
 * `onDataPointClick` callback so the viewer can apply the filter
 * without reloading.
 */

import { type FC, type RefObject, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import ReactECharts from 'echarts-for-react';
import type { EChartsInstance } from 'echarts-for-react';
import {
  buildAreaOption,
  buildBarHorizontalOption,
  buildBarVerticalOption,
  buildChartSummary,
  buildDonutOption,
  buildGaugeOption,
  buildLineOption,
  buildScatterOption,
  buildStackedBarOption,
  buildDivergingBarOption,
  type ChartLabels,
} from './chart-option.factory';
import type { ReportChartData } from './chart-types';
import type { ReportChartKind } from '../../../../domain/reports/report-types';

export interface ReportChartProps {
  data: ReportChartData;
  /** Optional title for the `aria-label` and the chart summary. */
  title?: string;
  /** When true, show the textual summary below the chart. */
  showSummary?: boolean;
  /** Click event — receives the clicked category/value. */
  onDataPointClick?: (point: { name?: string; value?: number | string; seriesName?: string }) => void;
  /** Optional data-zoom flag (default true for line/area/bar-horizontal). */
  withDataZoom?: boolean;
  /** Forwarded ref for callers that want to call `getDataURL()`. */
  echartsRef?: RefObject<ReactECharts | null>;
  /** Accessible summary override; otherwise the factory summary is used. */
  summaryOverride?: string;
}

export const ReportChart: FC<ReportChartProps> = ({
  data,
  title,
  showSummary = true,
  onDataPointClick,
  withDataZoom,
  echartsRef,
  summaryOverride,
}) => {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const localRef = useRef<ReactECharts | null>(null);
  const ref = (echartsRef ?? localRef) as RefObject<ReactECharts | null>;

  const chartLabels: ChartLabels = useMemo(() => ({
    scatterMargin: t('reports.charts.scatter_margin'),
    scatterProfit: t('reports.charts.scatter_profit'),
    tooltipMargin: t('reports.charts.tooltip_margin'),
    tooltipProfit: t('reports.charts.tooltip_profit'),
    summaryDistribution: t('reports.charts.summary_distribution'),
    summaryNumeric: t('reports.charts.summary_numeric'),
  }), [t]);

  const option = useMemo(
    () => buildOption(data, withDataZoom, locale, chartLabels),
    [data, withDataZoom, locale, chartLabels],
  );
  const summary = useMemo(
    () => summaryOverride ?? buildChartSummary(data, locale, chartLabels),
    [data, summaryOverride, locale, chartLabels],
  );

  const handleClick = useCallback(
    (params: unknown) => {
      if (!onDataPointClick) return;
      const p = params as {
        name?: string;
        value?: number | string;
        seriesName?: string;
      };
      onDataPointClick({ name: p.name, value: p.value, seriesName: p.seriesName });
    },
    [onDataPointClick],
  );

  const handleReady = useCallback((instance: EChartsInstance) => {
    instance.on('click', handleClick);
  }, [handleClick]);

  return (
    <figure className="flex flex-col gap-2" role="figure" aria-label={title}>
      <ReactECharts
        ref={ref}
        option={option}
        onChartReady={handleReady}
        notMerge
        lazyUpdate={false}
        style={{ height: 280, width: '100%' }}
        opts={{ renderer: 'svg' }}
      />
      {showSummary && summary ? (
        <figcaption className="text-caption" style={{ color: 'var(--color-ink-muted, #5A5754)' }}>
          {summary}
        </figcaption>
      ) : null}
    </figure>
  );
};

// ---------------------------------------------------------------------------
// Internal: option dispatcher
// ---------------------------------------------------------------------------

function buildOption(
  data: ReportChartData,
  withDataZoom?: boolean,
  locale?: string,
  labels?: ChartLabels,
) {
  switch (data.kind) {
    case 'line':
      return buildLineOption(data, withDataZoom ?? true, locale);
    case 'area':
      return buildAreaOption(data, locale);
    case 'bar_horizontal':
      return buildBarHorizontalOption(data, locale);
    case 'bar_vertical':
      return buildBarVerticalOption(data, locale);
    case 'stacked_bar':
      return buildStackedBarOption(data, locale);
    case 'donut':
      return buildDonutOption(data, locale);
    case 'scatter':
      return buildScatterOption(data, locale, labels);
    case 'diverging_bar':
      return buildDivergingBarOption(data, locale);
    case 'gauge':
      return buildGaugeOption(
        Number(data.series[0]?.data[0] ?? 0),
        Number((data.series[0]?.data[0] as number | undefined) ?? 100) * 2,
        String(data.series[0]?.name ?? ''),
        locale,
      );
    case 'none':
    default:
      return {};
  }
}

export type { ReportChartKind };
