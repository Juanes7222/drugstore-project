/**
 * Cashier-facing sync-status banner.
 *
 * Three tiers, only one visible at a time (highest-priority wins):
 *   1. BACKUP_CRITICAL — backup state is critical, needs admin.
 *   2. PERMANENT_FAILURE — items exhausted retries, needs admin review.
 *   3. PENDING — items waiting to sync (calm info, not an alert).
 *
 * Hidden entirely when all counts are zero.
 * Polls every 30s, pauses on tab hide.
 *
 * Informational only: queued business movements can never be discarded
 * from this (or any) UI — failed entries are retried from the admin sync
 * health screen, never deleted.
 */

import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangleIcon, ClockIcon } from "@/components/ui/icons";
import { getLocalDatabase } from "../../../infrastructure/local-database";
import type { PrismaClient } from "@pharmacy/database/local";
import { createSyncMetricsService } from "../../../domain/sync/sync-metrics.service";

type BannerVariant = "permanent_failure" | "pending" | "backup_critical";

const bannerConfig: Record<
  BannerVariant,
  {
    bg: string;
    border: string;
    text: string;
    icon: typeof ClockIcon;
    titleKey: string;
    descKey: string;
  }
> = {
  permanent_failure: {
    bg: "bg-urgency/10",
    border: "border-urgency/40",
    text: "text-urgency",
    icon: AlertTriangleIcon,
    titleKey: "sync.attention_banner.permanent_failure_title",
    descKey: "sync.attention_banner.permanent_failure_description",
  },
  pending: {
    bg: "bg-sync/8",
    border: "border-sync/30",
    text: "text-sync",
    icon: ClockIcon,
    titleKey: "sync.attention_banner.pending_title",
    descKey: "sync.attention_banner.pending_description",
  },
  backup_critical: {
    bg: "bg-error-container",
    border: "border-error/40",
    text: "text-error",
    icon: AlertTriangleIcon,
    titleKey: "sync.attention_banner.backup_critical_title",
    descKey: "sync.attention_banner.backup_critical_description",
  },
};

export const SyncAttentionBanner: FC = () => {
  const { t } = useTranslation();
  const [hasPermanentFailures, setHasPermanentFailures] = useState(false);
  const [hasPending, setHasPending] = useState(false);
  const [backupCritical, setBackupCritical] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [mounted, setMounted] = useState(false);

  const checkMetrics = useCallback(async () => {
    try {
      const { prisma: rawPrisma } = await getLocalDatabase();
      const metricsService = createSyncMetricsService(
        rawPrisma as PrismaClient,
      );
      const [counts, backupHealth] = await Promise.all([
        metricsService.getQueueCounts(),
        metricsService.getBackupHealth(),
      ]);
      setHasPermanentFailures(counts.permanentFailure > 0);
      setHasPending(counts.pending > 0);
      setBackupCritical(backupHealth === "CRITICAL");
    } catch {
      setHasPermanentFailures(false);
      setHasPending(false);
      setBackupCritical(false);
    }
  }, []);

  useEffect(() => {
    setMounted(true);
    void checkMetrics();

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkMetrics();
        intervalRef.current = setInterval(checkMetrics, 30_000);
      } else if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    intervalRef.current = setInterval(checkMetrics, 30_000);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkMetrics]);

  // Priority: backup_critical > permanent_failure > pending
  let variant: BannerVariant | null = null;
  if (backupCritical) {
    variant = "backup_critical";
  } else if (hasPermanentFailures) {
    variant = "permanent_failure";
  } else if (hasPending) {
    variant = "pending";
  }

  const config = variant ? bannerConfig[variant] : null;
  const Icon = config?.icon ?? ClockIcon;
  const show = mounted && variant !== null;

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key={variant}
          role="status"
          aria-live="polite"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className={`flex items-center gap-3 overflow-hidden border-b px-4 py-2 text-sm ${config!.bg} ${config!.border}`}
        >
          <Icon
            className={`h-4 w-4 shrink-0 ${config!.text}`}
            aria-hidden="true"
          />
          <span className={`font-semibold ${config!.text}`}>
            {t(config!.titleKey)}
          </span>
          <span className="text-ink/60 text-caption">
            {t(config!.descKey)}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
