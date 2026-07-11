/**
 * KPI grid for the Sync Health dashboard.
 *
 * Displays summary metrics (pending, failed, permanent failures, success
 * rate, last backup) in a responsive 2–4 column grid of coloured-accent
 * tiles.  The Last Backup tile is clickable.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { QueueCounts } from "../../../domain/sync/sync-metrics.service";

interface KpiGridProps {
  counts: QueueCounts | null;
  successRateDisplay: string;
  successRateColor: string;
  backupSummary: {
    lastBackupAt: string | null;
    backupHealth: string;
  } | null;
  onBackupClick: () => void;
}

interface TileDef {
  labelKey: string;
  labelFallback: string;
  value: string;
  accentColor: string;
  subLabel?: string;
  onClick?: () => void;
  testId?: string;
}

export const KpiGrid: FC<KpiGridProps> = ({
  counts,
  successRateDisplay,
  successRateColor,
  backupSummary,
  onBackupClick,
}) => {
  const { t } = useTranslation();

  const tiles: TileDef[] = [
    {
      labelKey: "sync.kpi_pending",
      labelFallback: "Pending",
      value: counts?.pending.toLocaleString() ?? "\u2014",
      accentColor: "border-l-amber-400",
    },
    {
      labelKey: "sync.kpi_failed_24h",
      labelFallback: "Failed (24h)",
      value: counts?.failed.toLocaleString() ?? "\u2014",
      accentColor: "border-l-red-400",
    },
    {
      labelKey: "sync.kpi_permanent_failures",
      labelFallback: "Permanent Failures",
      value: counts?.permanentFailure.toLocaleString() ?? "\u2014",
      accentColor: "border-l-red-600",
    },
    {
      labelKey: "sync.kpi_success_rate",
      labelFallback: "Success Rate (24h)",
      value: successRateDisplay,
      accentColor: `border-l-[${successRateColor}]`,
      subLabel:
        counts && counts.completed24h + counts.failed + counts.permanentFailure > 0
          ? `${counts.completed24h.toLocaleString()} completed`
          : undefined,
    },
    {
      labelKey: "sync.kpi_last_backup",
      labelFallback: "Last Backup",
      value: backupSummary?.lastBackupAt
        ? new Date(backupSummary.lastBackupAt).toLocaleString()
        : "\u2014",
      accentColor:
        backupSummary?.backupHealth === "HEALTHY"
          ? "border-l-green-500"
          : backupSummary?.backupHealth === "STALE"
            ? "border-l-amber-500"
            : "border-l-gray-400",
      subLabel: backupSummary
        ? t("sync.backup_health_label", {
            defaultValue: "Health: {{health}}",
            health: backupSummary.backupHealth,
          })
        : undefined,
      onClick: onBackupClick,
      testId: "kpi-last-backup",
    },
  ];

  const handleClick = useCallback(
    (tile: TileDef) => () => {
      tile.onClick?.();
    },
    [],
  );

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((tile) => {
        const isClickable = Boolean(tile.onClick);
        const Comp = isClickable ? "button" : "div";

        return (
          <Comp
            key={tile.labelKey}
            type={isClickable ? "button" : undefined}
            onClick={isClickable ? handleClick(tile) : undefined}
            data-testid={tile.testId}
            className={`flex flex-col gap-1 rounded-lg border border-gray-200 bg-white p-4 text-left shadow-sm transition-shadow hover:shadow-md ${tile.accentColor} border-l-4 ${isClickable ? "cursor-pointer" : ""}`}
          >
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
              {t(tile.labelKey, tile.labelFallback)}
            </span>
            <span className="text-2xl font-bold text-gray-900 tabular-nums">
              {tile.value}
            </span>
            {tile.subLabel && (
              <span className="text-xs text-gray-500">{tile.subLabel}</span>
            )}
          </Comp>
        );
      })}
    </div>
  );
};
