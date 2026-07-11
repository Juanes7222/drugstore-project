/**
 * Empty-state placeholder shown when no sync data exists yet.
 *
 * Renders a centered card with a descriptive message, used when the
 * timeline is empty and no operations have been recorded.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";

export const NoSyncDataPlaceholder: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="mb-6 flex items-center justify-center rounded-lg border border-gray-200 bg-white p-12 shadow-sm">
      <div className="flex flex-col items-center gap-2 text-center">
        <svg
          className="h-10 w-10 text-gray-300"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776"
          />
        </svg>
        <h3 className="text-base font-semibold text-gray-600">
          {t("sync.no_data_title", "No sync data yet")}
        </h3>
        <p className="max-w-xs text-sm text-gray-400">
          {t(
            "sync.no_data_description",
            "Sync operations will appear here once the system starts processing. This is normal for a fresh installation.",
          )}
        </p>
      </div>
    </div>
  );
};
