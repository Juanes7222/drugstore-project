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
import { FolderIcon } from "@/components/ui/icons";

export const NoSyncDataPlaceholder: FC = () => {
  const { t } = useTranslation();

  return (
    <div className="mb-6 flex items-center justify-center rounded-lg border border-gray-200 bg-white p-12 shadow-sm">
      <div className="flex flex-col items-center gap-2 text-center">
        <FolderIcon className="h-10 w-10 text-gray-300" />
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
