/**
 * Local report error state with retry.
 */

import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircleIcon } from "@/components/ui/icons";

interface ReportErrorStateProps {
  message: string;
  onRetry: () => void;
}

export const ReportErrorState: FC<ReportErrorStateProps> = ({ message, onRetry }) => {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-rose-300 bg-rose-50 p-8 text-center text-rose-900">
      <AlertCircleIcon className="h-8 w-8" aria-hidden />
      <h3 className="text-body font-semibold">{t("reports.error.title")}</h3>
      <p className="text-body-sm">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md bg-pharma px-3 py-1.5 text-body-sm font-medium text-white"
      >
        {t("reports.viewer.execute")}
      </button>
    </div>
  );
};
