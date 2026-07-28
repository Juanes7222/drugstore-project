/**
 * Failure breakdown panel with filter pills.
 *
 * Shows failure categories as toggle-able pills with count badges and
 * time since most recent occurrence. Uses design-system tokens, lucide
 * icons, and motion staggered entrance. Clicking a pill toggles it as
 * a category filter.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { AlertTriangle } from "lucide-react";
import type { FailureBreakdownEntry } from "../../../domain/sync/sync-metrics.service";
import { formatRelativeTimeEs } from "../../hooks/use-relative-time";

interface FailureBreakdownPanelProps {
  data: FailureBreakdownEntry[];
  selectedCategory: string | null;
  onSelectCategory: (category: string | null) => void;
}

export const FailureBreakdownPanel: FC<FailureBreakdownPanelProps> = ({
  data,
  selectedCategory,
  onSelectCategory,
}) => {
  const { t } = useTranslation();

  const handlePillClick = useCallback(
    (category: string) => () => {
      onSelectCategory(selectedCategory === category ? null : category);
    },
    [selectedCategory, onSelectCategory],
  );

  return (
    <div className="mb-6 rounded-lg border border-border bg-panel p-4 shadow-pos-panel">
      <h3 className="mb-3 text-body-sm font-semibold text-ink">
        {t("sync.failure_breakdown_title")}
      </h3>

      {data.length === 0 ? (
        <motion.p
          className="py-4 text-center text-body-sm text-ink-muted"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          {t("sync.failure_breakdown_empty")}
        </motion.p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.map((entry, idx) => {
            const isSelected = selectedCategory === entry.category;

            return (
              <motion.button
                key={entry.category}
                type="button"
                onClick={handlePillClick(entry.category)}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.2, delay: idx * 0.04, ease: "easeOut" }}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-body-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                  isSelected
                    ? "bg-pharma text-white focus:ring-pharma"
                    : "bg-surface text-ink hover:bg-surface-variant focus:ring-pharma"
                }`}
              >
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{t(`sync.failure_cat.${entry.category}`, { defaultValue: entry.category })}</span>
                <span
                  className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-caption font-bold tabular-nums ${
                    isSelected
                      ? "bg-pharma/30 text-white"
                      : "bg-surface-variant text-ink-muted"
                  }`}
                >
                  {entry.count.toLocaleString()}
                </span>
                {entry.mostRecent && (
                  <span
                    className={`text-caption ${
                      isSelected ? "text-white/70" : "text-ink-muted"
                    }`}
                  >
                    {t("sync.failure_latest", {
                      time: formatRelativeTimeEs(entry.mostRecent),
                    })}
                  </span>
                )}
              </motion.button>
            );
          })}
        </div>
      )}
    </div>
  );
};
