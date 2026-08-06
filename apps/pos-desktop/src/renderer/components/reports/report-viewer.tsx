/**
 * Report viewer — orchestrates title, filters, KPI cards, chart, table,
 * and export actions.  Pure UI; the page wires data into it.
 */

import { type FC, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type ReactECharts from "echarts-for-react";
import { useReportsUiStore } from "../../stores/reports.store";
import { useServiceContext } from "../common/service-context";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";
import { getReportDefinition, reportConfigSatisfied } from "../../../domain/reports/report-catalog";
import type { ReportResponse } from "../../../domain/reports/report-types";
import { useReportConfigContext } from "./use-report-config-context";
import { createFormatters } from "./use-reports-locale";
import type { ShiftOption } from "./shift-picker";
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
  /** A required filter is not selected yet; show the calm hint instead of running. */
  notReady?: boolean;
}

/**
 * Maximum KPI cards rendered in the grid.  The execution service may
 * return more (e.g. delivery KPIs, sync warnings); the detail still
 * reaches the export.  Keeping the on-screen set short prevents the
 * "wall of numbers" the reports module is meant to avoid.
 */
const MAX_VISIBLE_KPIS = 6;

export const ReportViewer: FC<ReportViewerProps> = ({ onExecute, isLoading, notReady = false }) => {
  const { t, i18n } = useTranslation();
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
  const configContext = useReportConfigContext();
  // Config-gated reports (lot / expiry tracking) must never render when
  // the effective purchases config does not enable them — even if a
  // stale active report survived from a previous configuration.
  // (`reportConfigSatisfied` never gates while the config is still null.)
  const configDisabled = def !== null && !reportConfigSatisfied(def, configContext);
  const chartRef = useRef<ReactECharts | null>(null);
  const [shiftOptions, setShiftOptions] = useState<ShiftOption[]>([]);
  const [shiftsLoading, setShiftsLoading] = useState(false);
  // The detail table is collapsed by default when a chart carries the
  // message; table-only reports (chart kind 'none') open it right away.
  const [showTable, setShowTable] = useState<boolean>(() => def?.chart.kind === 'none');

  // Reset the table visibility whenever the active report changes.
  useEffect(() => {
    setShowTable(def?.chart.kind === 'none');
  }, [def]);

  // Load the shift list for the CASH_SHIFT_CLOSE selector (closed shifts only:
  // an open shift has no closing document to report on).
  useEffect(() => {
    if (!def || def.code !== 'CASH_SHIFT_CLOSE') return;
    let cancelled = false;
    setShiftsLoading(true);
    const dateTime = createFormatters(i18n.language).dateTime;
    services.cashShiftService
      .getShiftHistory({ limit: 50, offset: 0 })
      .then(({ shifts }) => {
        if (cancelled) return;
        setShiftOptions(
          shifts
            .filter((s) => s.state === 'CLOSED' || s.state === 'FORCED_CLOSE')
            .map((s) => ({
              id: s.id,
              label:
                s.closedAt !== null
                  ? `${dateTime.format(s.openedAt)} - ${dateTime.format(s.closedAt)}`
                  : dateTime.format(s.openedAt),
              stateLabel:
                s.state === 'FORCED_CLOSE'
                  ? t('cash_shift.state_forced_close')
                  : t('cash_shift.state_closed'),
              forced: s.state === 'FORCED_CLOSE',
            })),
        );
      })
      .catch(() => {
        if (!cancelled) setShiftOptions([]);
      })
      .finally(() => {
        if (!cancelled) setShiftsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [def, services, t, i18n.language]);

  const chartData: ReportChartData | null = useMemo(() => {
    if (!lastResponse) return null;
    return {
      kind: lastResponse.chart.kind,
      xAxis: (lastResponse.chart.xAxis as Array<string | number> | undefined) ?? [],
      series: lastResponse.chart.series as ReportChartData['series'],
      unit: lastResponse.chart.unit,
      scatterAxes: lastResponse.chart.scatterAxes,
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

  if (configDisabled) {
    return (
      <ReportEmptyState
        title={t("reports.error.config_disabled_title")}
        body={t("reports.error.config_disabled")}
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
        shiftOptions={shiftOptions}
        shiftsLoading={shiftsLoading}
      />

      {notReady && !lastResponse ? (
        <ReportEmptyState
          title={t("reports.filters.select_shift")}
          body={t("reports.filters.select_shift_hint")}
        />
      ) : null}

      {lastResponse ? (
        <>
          <ReportKpis
            kpis={lastResponse.kpis.slice(0, MAX_VISIBLE_KPIS)}
            fromCache={lastResponse.fromCache}
          />
          {lastResponse.rows.length === 0 ? (
            // A report that ran but found nothing must say so explicitly —
            // an empty chart/table reads as a rendering bug, not as "no
            // products without movement in this period".
            <ReportEmptyState
              title={t("reports.empty.title")}
              body={t("reports.warnings.empty")}
            />
          ) : (
            <>
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
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-white">
                <button
                  type="button"
                  onClick={() => setShowTable((v) => !v)}
                  aria-expanded={showTable}
                  className="flex items-center justify-between gap-2 px-4 py-2.5 text-body-sm font-medium text-ink transition hover:bg-amber-50"
                >
                  <span>{t("reports.viewer.detail")}</span>
                  <span className="text-caption text-muted">
                    {t("reports.viewer.rows_count", { total: lastResponse.total })}
                    <span className="ml-2 inline-flex items-center rounded bg-surface px-2 py-0.5 text-muted">
                      {showTable ? t("reports.viewer.hide") : t("reports.viewer.show")}
                    </span>
                  </span>
                </button>
                {showTable ? (
                  <ReportTable
                    definition={def}
                    rows={lastResponse.rows}
                    total={lastResponse.total}
                    chartFilter={chartFilter}
                  />
                ) : null}
              </div>
            </>
          )}
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
