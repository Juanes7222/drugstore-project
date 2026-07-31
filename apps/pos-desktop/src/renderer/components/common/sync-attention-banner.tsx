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
 * The PERMANENT_FAILURE variant offers a "Discard all" action for clearing
 * test/noise entries. Two-step inline confirm (no modal) keeps the action
 * close at hand for power users without disrupting the cashier's flow.
 */

import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { AlertTriangleIcon, ClockIcon, Trash2Icon } from "@/components/ui/icons";
import { getLocalDatabase } from "../../../infrastructure/local-database";
import type { PrismaClient } from "@pharmacy/database/local";
import { createSyncMetricsService } from "../../../domain/sync/sync-metrics.service";
import { createSyncRecoveryService } from "../../../domain/sync/sync-recovery.service";
import { useLocalSessionStore } from "../../../domain/auth/local-session.store";

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

  // Discard-all inline confirmation state
  const [discardAllConfirming, setDiscardAllConfirming] = useState(false);
  const [discardAllSubmitting, setDiscardAllSubmitting] = useState(false);

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

  // Reset the discard-confirm state when the banner hides
  useEffect(() => {
    if (!hasPermanentFailures && discardAllConfirming) {
      setDiscardAllConfirming(false);
    }
  }, [hasPermanentFailures, discardAllConfirming]);

  const handleDiscardAllClick = useCallback(() => {
    if (discardAllConfirming) {
      // Second click — execute
      void executeDiscardAll();
    } else {
      // First click — ask for confirmation
      setDiscardAllConfirming(true);
    }
  }, [discardAllConfirming]);

  const executeDiscardAll = useCallback(async () => {
    setDiscardAllSubmitting(true);
    try {
      const session = useLocalSessionStore.getState().session;
      const actorUserId = session?.userId ?? "system";
      const { prisma: rawPrisma } = await getLocalDatabase();
      const prisma = rawPrisma as PrismaClient;
      const recoveryService = createSyncRecoveryService({ prisma });
      await recoveryService.discardAllPermanentFailures(
        t("sync.attention_banner.discard_all_reason"),
        actorUserId,
      );
      setDiscardAllConfirming(false);
      await checkMetrics();
    } catch {
      // Leave the user on the confirming state so they can retry or close
    } finally {
      setDiscardAllSubmitting(false);
    }
  }, [checkMetrics, t]);

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

          {variant === "permanent_failure" && (
            <div className="ml-auto flex items-center gap-2">
              {discardAllConfirming && (
                <span className="text-caption text-ink/60">
                  {t("sync.attention_banner.discard_all_confirm_hint")}
                </span>
              )}
              <button
                type="button"
                onClick={
                  discardAllConfirming
                    ? () => setDiscardAllConfirming(false)
                    : handleDiscardAllClick
                }
                disabled={discardAllSubmitting}
                className={`flex items-center gap-1 rounded border px-2 py-0.5 text-caption font-medium transition-colors disabled:opacity-50 ${
                  discardAllConfirming
                    ? "border-ink/20 bg-white text-ink/70 hover:bg-ink/5"
                    : "border-urgency/40 bg-white/60 text-urgency hover:bg-urgency/10"
                }`}
              >
                {discardAllConfirming
                  ? t("common.cancel", "Cancelar")
                  : t("sync.attention_banner.discard_all_button")}
              </button>
              {discardAllConfirming && (
                <button
                  type="button"
                  onClick={handleDiscardAllClick}
                  disabled={discardAllSubmitting}
                  className="flex items-center gap-1 rounded border border-red-500 bg-red-600 px-2 py-0.5 text-caption font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
                >
                  <Trash2Icon className="h-3 w-3" aria-hidden="true" />
                  {discardAllSubmitting
                    ? t("common.processing", "Procesando…")
                    : t("sync.attention_banner.discard_all_confirm_button")}
                </button>
              )}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};
