/**
 * Report header — title, description, freshness metadata, chart-derived
 * filter chip.
 */

import { type FC, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { XIcon } from "@/components/ui/icons";
import type { ReportDefinition, ReportResponse } from "../../../domain/reports/report-types";
import type { ChartFilter } from "../../stores/reports.store";

interface ReportHeaderProps {
  definition: ReportDefinition;
  response: ReportResponse | null;
  chartFilter: ChartFilter | null;
  onClearChartFilter: () => void;
}

export const ReportHeader: FC<ReportHeaderProps> = ({
  definition,
  response,
  chartFilter,
  onClearChartFilter,
}) => {
  const { t } = useTranslation();
  const cacheRemainingSeconds = useMemo(() => {
    if (!response?.fromCache) return 0;
    const generatedAt = new Date(response.freshness.generatedAt).getTime();
    const elapsed = (Date.now() - generatedAt) / 1000;
    return Math.max(0, Math.round(definition.cacheTtlMs / 1000 - elapsed));
  }, [definition.cacheTtlMs, response]);

  // The chip must show the translated column title, never the internal
  // column id (a technical identifier the user should not see).
  const chartFilterColumnTitle = useMemo(() => {
    if (!chartFilter) return "";
    const column = definition.columns.find((c) => c.id === chartFilter.columnId);
    return column ? t(column.titleKey) : chartFilter.columnId;
  }, [chartFilter, definition.columns, t]);

  return (
    <header className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-h3">{t(definition.titleKey)}</h2>
          <p className="text-body-sm text-muted">{t(definition.descriptionKey)}</p>
        </div>
        {response ? (
          <div className="text-caption text-muted">
            {t("reports.viewer.generated_in", { ms: response.executionMs })}
            {response.fromCache ? (
              <span className="ml-2 inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-amber-700">
                {t("reports.viewer.from_cache", { seconds: cacheRemainingSeconds })}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="text-caption text-muted">{t("reports.data_source")}</p>
      {chartFilter ? (
        <div className="mt-1 inline-flex w-fit items-center gap-2 rounded-full bg-amber-100 px-3 py-1 text-caption text-amber-800">
          <span>
            {t("reports.header.active_filter")}: <b>{chartFilter.value}</b> {t("reports.header.in_column")} {chartFilterColumnTitle}
          </span>
          <button
            type="button"
            aria-label={t("reports.header.remove_filter")}
            onClick={onClearChartFilter}
            className="rounded-full p-0.5 hover:bg-amber-200"
          >
            <XIcon className="h-3 w-3" />
          </button>
        </div>
      ) : null}
    </header>
  );
};
