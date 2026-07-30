/**
 * Report viewer — orchestrates title, filters, KPI cards, chart, table,
 * and export actions.  Pure UI; the page wires data into it.
 */

import { type FC, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type ReactECharts from "echarts-for-react";
import { useReportsUiStore } from "../../stores/reports.store";
import { useServiceContext } from "../common/service-context";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { getReportDefinition } from "../../../domain/reports/report-catalog";
import type { ReportResponse } from "../../../domain/reports/report-types";
import { ReportHeader } from "./report-header";
import { ReportFilters } from "./report-filters";
import { ReportKpis } from "./report-kpis";
import { ReportTable } from "./report-table";
import { ReportExportActions } from "./report-export-actions";
import { ReportChart } from "./charts/report-chart";
import { ReportEmptyState } from "./report-empty-state";
import type { ReportChartData } from "./charts/chart-types";

interface ReportViewerProps {
  onExecute: () => void;
  isLoading: boolean;
}

export const ReportViewer: FC<ReportViewerProps> = ({ onExecute, isLoading }) => {
  const { t } = useTranslation();
  const services = useServiceContext();
  const session = useLocalSessionStore((s) => s.session);
  const activeCode = useReportsUiStore((s) => s.activeReportCode);
  const lastResponse = useReportsUiStore((s) => s.lastResponse);
  const appliedFilters = useReportsUiStore((s) => s.appliedFilters);
  const setFilters = useReportsUiStore((s) => s.setAppliedFilters);
  const applyChartFilter = useReportsUiStore((s) => s.applyChartFilter);
  const chartFilter = useReportsUiStore((s) => s.chartFilter);
  const clearChartFilter = useReportsUiStore((s) => s.clearChartFilter);

  const def = activeCode ? getReportDefinition(activeCode) : null;
  const chartRef = useRef<ReactECharts | null>(null);

  const chartData: ReportChartData | null = useMemo(() => {
    if (!lastResponse) return null;
    return {
      kind: lastResponse.chart.kind,
      xAxis: (lastResponse.chart.xAxis as Array<string | number> | undefined) ?? [],
      series: lastResponse.chart.series as ReportChartData['series'],
    };
  }, [lastResponse]);

  const handleChartClick = useCallback(
    (point: { name?: string; value?: number | string; seriesName?: string }) => {
      if (!def || !point.name) return;
      // The first textual column of the report definition receives the
      // chart-derived filter.  This is a soft hint — the table will
      // bold the matching row.
      const targetCol = def.columns.find(
        (c) => c.type !== 'integer' && c.type !== 'number' && c.type !== 'currency' && c.type !== 'percent',
      );
      if (!targetCol) return;
      applyChartFilter({ columnId: targetCol.id, value: point.name });
    },
    [applyChartFilter, def],
  );

  if (!def || !activeCode) {
    return (
      <ReportEmptyState
        title={t("reports.empty.title")}
        body={t("reports.empty.body")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <ReportHeader
        definition={def}
        response={lastResponse}
        chartFilter={chartFilter}
        onClearChartFilter={clearChartFilter}
      />

      <ReportFilters
        definition={def}
        value={appliedFilters ?? def.defaultFilters}
        onChange={(f) => setFilters(f)}
        onApply={onExecute}
      />

      {lastResponse ? (
        <>
          <ReportKpis kpis={lastResponse.kpis} fromCache={lastResponse.fromCache} />
          {chartData && def.chart.kind !== 'none' ? (
            <div className="rounded-lg border border-border bg-white p-4">
              <ReportChart
                data={chartData}
                title={t(def.titleKey)}
                echartsRef={chartRef}
                showSummary
                onDataPointClick={handleChartClick}
              />
            </div>
          ) : null}
          <ReportTable
            definition={def}
            rows={lastResponse.rows}
            total={lastResponse.total}
            chartFilter={chartFilter}
          />
          <ReportExportActions
            response={lastResponse}
            definition={def}
            services={services}
            userDisplayName={session?.fullName ?? session?.userId ?? 'local-user'}
            chartRef={chartRef}
            isLoading={isLoading}
          />
        </>
      ) : isLoading ? (
        <p className="text-body-sm text-muted">{t("reports.viewer.loading")}</p>
      ) : null}
    </div>
  );
};

export type { ReportResponse };
