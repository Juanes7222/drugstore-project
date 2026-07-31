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
import { LoaderIcon } from "@/components/ui/icons/animated";

export const SyncHealthLoading: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="flex h-full items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <LoaderIcon className="h-10 w-10 text-gray-400" />
        <p className="text-sm font-medium text-gray-500">
          {t("sync.loading", "Loading sync health data\u2026")}
        </p>
      </div>
    </div>
  );
};
