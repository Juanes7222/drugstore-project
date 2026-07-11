/**
 * Failure breakdown panel with filter pills.
 *
 * Displays a card titled "Failure Breakdown" with rounded filter pills.
 * Each pill shows the failure category, count, and time since the most
 * recent occurrence.  Clicking a pill toggles its selection as a category
 * filter.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { FailureBreakdownEntry } from "../../../domain/sync/sync-metrics.service";
import { formatRelativeTime } from "../../../common/time-format";

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
      if (selectedCategory === category) {
        onSelectCategory(null);
      } else {
        onSelectCategory(category);
      }
    },
    [selectedCategory, onSelectCategory],
  );

  return (
    <div className="mb-6 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-gray-700">
        {t("sync.failure_breakdown_title", "Failure Breakdown")}
      </h3>

      {data.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">
          {t("sync.failure_breakdown_empty", "No failure data available")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {data.map((entry) => {
            const isSelected = selectedCategory === entry.category;

            return (
              <button
                key={entry.category}
                type="button"
                onClick={handlePillClick(entry.category)}
                className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                  isSelected
                    ? "bg-blue-600 text-white focus:ring-blue-500"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200 focus:ring-gray-400"
                }`}
              >
                <span>{entry.category}</span>
                <span
                  className={`inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-xs font-bold tabular-nums ${
                    isSelected
                      ? "bg-blue-500 text-white"
                      : "bg-gray-200 text-gray-600"
                  }`}
                >
                  {entry.count.toLocaleString()}
                </span>
                {entry.mostRecent && (
                  <span
                    className={`text-xs ${
                      isSelected ? "text-blue-200" : "text-gray-400"
                    }`}
                  >
                    {t("sync.failure_latest", {
                      defaultValue: "latest: {{time}} ago",
                      time: formatRelativeTime(entry.mostRecent),
                    })}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
