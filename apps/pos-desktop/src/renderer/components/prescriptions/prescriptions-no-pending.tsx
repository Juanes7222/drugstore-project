/**
 * PrescriptionsNoPending — centered fallback shown when there is no pending
 * prescription item to process.
 *
 * Displays a neutral message and a "Back" button that returns the user to
 * the payment screen and clears the prescription flow state.
 */
import { type FC, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useAppDispatch } from "@/store/hooks";
import { clearPrescriptionFlow, setActiveScreen } from "@/store/slices/ui-slice";

export const PrescriptionsNoPending: FC = () => {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();

  const handleBack = useCallback(() => {
    dispatch(clearPrescriptionFlow());
    dispatch(setActiveScreen("payment"));
  }, [dispatch]);

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-pos-lg px-pos-xl"
      style={{ backgroundColor: "var(--color-surface)" }}
    >
      <p
        className="text-body text-center"
        style={{ color: "color-mix(in srgb, var(--color-ink) 55%, transparent)" }}
      >
        {t("prescriptions.no_pending")}
      </p>

      <button
        type="button"
        onClick={handleBack}
        className="pos-button pos-button-secondary"
      >
        {t("common.back")}
      </button>
    </div>
  );
};
