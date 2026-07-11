/**
 * Full-height centered loading spinner for the Sync Health screen.
 *
 * Renders a gray spinner with "Loading sync health data…" text while the
 * metrics service aggregates data from the local database.
 *
 * @category Component
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";

export const SyncHealthLoading: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex h-full items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <svg
          className="h-10 w-10 animate-spin text-gray-400"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <p className="text-sm font-medium text-gray-500">
          {t("sync.loading", "Loading sync health data\u2026")}
        </p>
      </div>
    </div>
  );
};
