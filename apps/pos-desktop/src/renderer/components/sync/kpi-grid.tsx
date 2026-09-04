/**
 * KPI grid for the Sync Health dashboard.
 *
 * Displays summary metrics (pending, failed, permanent failures, success
 * rate, last backup) in a responsive 2–4 column grid of accent-bordered
 * tiles. Uses design-system tokens for colours and shared ui/icons components.
 * The Last Backup tile is clickable. The Pending tile is LAN-aware.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { AlertTriangleIcon, BanIcon, ClockIcon, HardDriveIcon, TrendingUpIcon } from "@/components/ui/icons";
import type { QueueCounts } from "../../../domain/sync/sync-metrics.service";

interface KpiGridProps {
  counts: QueueCounts | null;
  successRateDisplay: string;
  backupSummary: {
    lastBackupAt: string | null;
    backupHealth: string;
  } | null;
  onBackupClick: () => void;
}

interface TileDef {
  labelKey: string;
  value: string;
  /** Tailwind border-l-{color} class */
  borderClass: string;
  /** Tailwind text-{color} class for the icon */
  iconColor: string;
  icon: typeof ClockIcon;
  subLabel?: string;
  /** Optional class for the subLabel — e.g. to show success green. */
  subLabelClass?: string;
  onClick?: () => void;
  testId?: string;
}

const TILE_ICONS = {
  pending: ClockIcon,
  failed: AlertTriangleIcon,
  permanent: BanIcon,
  successRate: TrendingUpIcon,
  backup: HardDriveIcon,
} as const;

export const KpiGrid: FC<KpiGridProps> = ({
  counts,
  successRateDisplay,
  backupSummary,
  onBackupClick,
}) => {
  const { t } = useTranslation();

  const backupBorderClass =
    backupSummary?.backupHealth === "HEALTHY"
      ? "border-l-success"
      : backupSummary?.backupHealth === "STALE"
        ? "border-l-warning"
        : "border-l-ink-muted";

  const backupIconClass =
    backupSummary?.backupHealth === "HEALTHY"
      ? "text-success"
      : backupSummary?.backupHealth === "STALE"
        ? "text-warning"
        : "text-ink-muted";

  // ── LAN-aware pending tile derivation ────────────────────────────────
  const pending = counts?.pending;
  const pendingLanRelayed = counts?.pendingLanRelayed;
  const pendingNotRelayed = counts?.pendingNotRelayed;

  let pendingSubLabel: string | undefined;
  let pendingSubLabelClass: string | undefined;

  if (counts == null || pending == null) {
    pendingSubLabel = undefined;
  } else if (pending === 0) {
    // No pending cloud ops — no sublabel needed; keep tile clean.
    pendingSubLabel = undefined;
  } else if (
    pendingLanRelayed != null &&
    pendingNotRelayed != null &&
    pendingLanRelayed > 0 &&
    pending === pendingLanRelayed
  ) {
    // All pending ops already relayed to Hub — green reassurance.
    pendingSubLabel = t("sync.lan_secured_in_hub", {
      defaultValue: "✓ Asegurado en Hub local",
    });
    // Guard: t returns key when missing; still show default.
    if (pendingSubLabel === "sync.lan_secured_in_hub") {
      pendingSubLabel = "✓ Asegurado en Hub local";
    }
    pendingSubLabelClass = "text-success font-medium";
  } else if (pendingLanRelayed != null && pendingNotRelayed != null) {
    pendingSubLabel = t("sync.lan_pending_detail", {
      secured: pendingLanRelayed,
      pending: pendingNotRelayed,
      defaultValue: `Asegurado en tienda: ${pendingLanRelayed} • Por replicar: ${pendingNotRelayed}`,
    });
    if (pendingSubLabel === "sync.lan_pending_detail") {
      pendingSubLabel = `Asegurado en tienda: ${pendingLanRelayed} • Por replicar: ${pendingNotRelayed}`;
    }
  }

  const tiles: TileDef[] = [
    {
      labelKey: "sync.kpi_pending",
      value: counts?.pending.toLocaleString() ?? "\u2014",
      borderClass: "border-l-warning",
      iconColor: "text-warning",
      icon: TILE_ICONS.pending,
      subLabel: pendingSubLabel,
      subLabelClass: pendingSubLabelClass,
      testId: "kpi-pending",
    },
    {
      labelKey: "sync.kpi_failed_24h",
      value: counts?.failed.toLocaleString() ?? "\u2014",
      borderClass: "border-l-error",
      iconColor: "text-error",
      icon: TILE_ICONS.failed,
    },
    {
      labelKey: "sync.kpi_permanent_failures",
      value: counts?.permanentFailure.toLocaleString() ?? "\u2014",
      borderClass: "border-l-error",
      iconColor: "text-error",
      icon: TILE_ICONS.permanent,
    },
    {
      labelKey: "sync.kpi_success_rate",
      value: successRateDisplay,
      borderClass: "border-l-pharma",
      iconColor: "text-pharma",
      icon: TILE_ICONS.successRate,
      subLabel:
        counts &&
        counts.completed24h + counts.failed + counts.permanentFailure > 0
          ? `${counts.completed24h.toLocaleString()} ${t("common.completed")}`
          : undefined,
    },
    {
      labelKey: "sync.kpi_last_backup",
      value: backupSummary?.lastBackupAt
        ? new Date(backupSummary.lastBackupAt).toLocaleString()
        : "\u2014",
      borderClass: backupBorderClass,
      iconColor: backupIconClass,
      icon: TILE_ICONS.backup,
      subLabel: backupSummary
        ? `${t("sync.health_label")}: ${backupSummary.backupHealth}`
        : undefined,
      onClick: onBackupClick,
      testId: "kpi-last-backup",
    },
  ];

  const handleClick = useCallback((tile: TileDef) => () => {
    tile.onClick?.();
  }, []);

  return (
    <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
      {tiles.map((tile, idx) => {
        const isClickable = Boolean(tile.onClick);
        const Comp = isClickable ? "button" : "div";
        const Icon = tile.icon;

        return (
          <motion.div
            key={tile.labelKey}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: idx * 0.06, ease: "easeOut" }}
          >
            <Comp
              type={isClickable ? "button" : undefined}
              onClick={isClickable ? handleClick(tile) : undefined}
              data-testid={tile.testId}
              className={`flex flex-col gap-1.5 rounded-lg border border-border bg-panel p-4 text-left shadow-pos-panel transition-shadow hover:shadow-pos-elevated ${tile.borderClass} border-l-4 ${isClickable ? "cursor-pointer" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-caption font-semibold uppercase tracking-wider text-ink-muted">
                  {t(tile.labelKey)}
                </span>
                <Icon
                  className={`h-4 w-4 ${tile.iconColor}`}
                  aria-hidden="true"
                />
              </div>
              <span className="font-data text-price font-bold tabular-nums text-ink">
                {tile.value}
              </span>
              {tile.subLabel && (
                <span
                  className={`text-caption ${tile.subLabelClass ?? "text-ink-muted"}`}
                  data-testid={tile.testId ? `${tile.testId}-sublabel` : undefined}
                >
                  {tile.subLabel}
                </span>
              )}
            </Comp>
          </motion.div>
        );
      })}
    </div>
  );
};
