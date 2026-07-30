/**
 * Local data-freshness banner.
 *
 * Renders the disclosure required by the local-first contract: where
 * the data came from, when the last sync completed, and how many
 * operations are still pending or in permanent failure.
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { formatRelativeTime } from "../../../common/time-format";
import type { ReportFreshness } from "../../../domain/reports/report-types";
import { useReportsLocale } from "./use-reports-locale";

interface ReportFreshnessBannerProps {
  freshness: ReportFreshness;
}

export const ReportFreshnessBanner: FC<ReportFreshnessBannerProps> = ({ freshness }) => {
  const { t } = useTranslation();
  const f = useReportsLocale();
  const hasWarning = freshness.pendingOperations > 0 || freshness.permanentFailures > 0;
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-md border px-4 py-3 text-body-sm ${
        hasWarning
          ? "border-amber-300 bg-amber-50 text-amber-900"
          : "border-emerald-200 bg-emerald-50 text-emerald-900"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <span>
          <strong>{t("reports.freshness.last_sync")}: </strong>
          {freshness.lastSyncAt
            ? `${formatRelativeTime(freshness.lastSyncAt)} (${f.dateTime.format(new Date(freshness.lastSyncAt))})`
            : t("reports.freshness.never")}
        </span>
        <span>
          <strong>{t("reports.freshness.pending")}: </strong>
          {freshness.pendingOperations}
        </span>
        <span>
          <strong>{t("reports.freshness.failures")}: </strong>
          {freshness.permanentFailures}
        </span>
      </div>
      {hasWarning ? <p className="mt-1 text-caption">{t("reports.freshness.warning")}</p> : null}
    </div>
  );
};
