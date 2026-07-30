/**
 * Error display panel for the Sync Health screen.
 *
 * Shows a red-toned error panel with the failure message and a retry button
 * so the user can re-trigger data loading without navigating away.
 *
 * @category Component
 */

import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { XCircleIcon } from "@/components/ui/icons";

interface SyncHealthErrorProps {
  error: string;
  onRetry: () => void;
}

export const SyncHealthError: FC<SyncHealthErrorProps> = ({
  error,
  onRetry,
}) => {
  const { t } = useTranslation();

  const handleRetry = useCallback(() => {
    onRetry();
  }, [onRetry]);

  return (
    <div className="flex h-full items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <XCircleIcon className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-500" />
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-red-800">
              {t("sync.error_title", "Failed to load sync data")}
            </h3>
            <p className="mt-1 text-sm text-red-700">{error}</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={handleRetry}
            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
          >
            {t("common.retry", "Retry")}
          </button>
        </div>
      </div>
    </div>
  );
};
