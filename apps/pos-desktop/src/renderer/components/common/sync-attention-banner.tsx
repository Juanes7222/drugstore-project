/**
 * Cashier-facing sync-attention banner.
 *
 * Shows when PERMANENT_FAILURE > 0 or stale PENDING > 0. Purely advisory —
 * no payload details, counts, or categories leaked. Hidden when both are zero.
 * Polls every 30s, pauses on tab hide.
 *
 * TODO: invoke pos-local agent to extract data-fetching into a reusable
 * useSyncMetrics() hook — this component should consume a hook, not import
 * infrastructure directly.
 */

import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangle, TriangleAlert } from "lucide-react";
import { getLocalDatabase } from "../../../infrastructure/local-database";
import type { PrismaClient } from "@pharmacy/database/local";
import { createSyncMetricsService } from "../../../domain/sync/sync-metrics.service";

type BannerVariant = "sync" | "backup";

const bannerConfig: Record<
  BannerVariant,
  {
    bg: string;
    border: string;
    text: string;
    icon: typeof AlertTriangle;
    titleKey: string;
    descKey: string;
  }
> = {
  sync: {
    bg: "bg-urgency/10",
    border: "border-urgency/40",
    text: "text-urgency",
    icon: AlertTriangle,
    titleKey: "sync.attention_banner.title",
    descKey: "sync.attention_banner.description",
  },
  backup: {
    bg: "bg-error-container",
    border: "border-error/40",
    text: "text-error",
    icon: TriangleAlert,
    titleKey: "sync.attention_banner.backup_critical_title",
    descKey: "sync.attention_banner.backup_critical_description",
  },
};

export const SyncAttentionBanner: FC = () => {
  const { t } = useTranslation();
  const [syncVisible, setSyncVisible] = useState(false);
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
      setSyncVisible(counts.permanentFailure > 0 || counts.stalePending > 0);
      setBackupCritical(backupHealth === "CRITICAL");
    } catch {
      setSyncVisible(false);
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

  const variant: BannerVariant | null = backupCritical
    ? "backup"
    : syncVisible
      ? "sync"
      : null;
  const config = variant ? bannerConfig[variant] : null;
  const Icon = config?.icon ?? AlertTriangle;
  const show = mounted && variant !== null;

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key={variant}
          role="alert"
          aria-live="assertive"
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
