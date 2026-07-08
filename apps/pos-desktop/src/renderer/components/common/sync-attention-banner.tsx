/**
 * Cashier-facing sync-attention banner.
 *
 * Shows when PERMANENT_FAILURE > 0 or stale PENDING > 0. Purely advisory —
 * no payload details, counts, or categories leaked. Hidden when both are zero.
 * Polls every 30s, pauses on tab hide.
 */

import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { getLocalDatabase } from "../../infrastructure/local-database";
import { createSyncMetricsService } from "../../../modules/sync/sync-metrics.service";

export const SyncAttentionBanner: FC = () => {
  const [visible, setVisible] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkMetrics = useCallback(async () => {
    try {
      const { prisma } = await getLocalDatabase();
      const counts = await createSyncMetricsService(prisma).getQueueCounts();
      setVisible(counts.permanentFailure > 0 || counts.stalePending > 0);
    } catch {
      setVisible(false);
    }
  }, []);

  useEffect(() => {
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

  if (!visible) return null;

  return (
    <div
      className="flex items-center justify-between bg-amber-100 border-b border-amber-500 text-amber-900 px-4 py-2 text-sm"
      role="alert"
    >
      <span>
        <strong>Sync needs attention</strong> — some operations could not be
        synchronised with the server.
      </span>
      <span>Contact a manager to review the sync status.</span>
    </div>
  );
};
