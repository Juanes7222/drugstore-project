/**
 * CheckoutPayment — waiting step while the customer pays on the Wompi page.
 *
 * The hosted payment page is opened in the system browser; this screen
 * explains that, offers to reopen the gateway when the browser blocked the
 * first attempt, and shows the polling indicator while the session is
 * verified in the background.
 *
 * @category Component
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import type { SessionStatus } from "../../../domain/licensing/wompi-checkout.service";
import { AlertTriangleIcon, CreditCardIcon, XIcon } from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";

export interface CheckoutPaymentProps {
  isPolling: boolean;
  lastStatus: SessionStatus | null;
  /** "CHECKOUT_OPEN_FAILED" when the system browser refused to open. */
  errorCode: string | null;
  onRetryOpen: () => void;
  onCancel: () => void;
}

export const CheckoutPayment: FC<CheckoutPaymentProps> = ({
  isPolling,
  lastStatus,
  errorCode,
  onRetryOpen,
  onCancel,
}) => {
  const { t } = useTranslation();

  // Prefer the server-provided status message; fall back to the generic
  // pending copy so the user always sees *something* about the wait.
  const statusHint =
    lastStatus?.statusMessage ?? t("licensing.plans.payment.pending_status");

  return (
    <section
      aria-label={t("licensing.plans.payment.title")}
      className="flex h-full flex-col items-center justify-center bg-surface p-pos-lg"
    >
      <div className="w-full max-w-lg rounded-pos border border-border bg-panel p-pos-xl shadow-pos-panel">
        <div className="mb-pos-md flex items-center gap-pos-md">
          <CreditCardIcon className="h-6 w-6 text-pharma" aria-hidden="true" />
          <h1 className="text-heading font-semibold text-ink">
            {t("licensing.plans.payment.title")}
          </h1>
        </div>

        <p className="mb-pos-lg text-body text-ink-muted">
          {t("licensing.plans.payment.description")}
        </p>

        {/* Polling indicator — calm Sync Slate, matching the offline-first
            waiting language of the app. */}
        {isPolling && (
          <div
            className="mb-pos-lg flex items-center gap-pos-sm rounded-pos border border-sync/30 bg-sync/5 px-pos-md py-pos-sm text-body-sm text-sync"
            role="status"
            aria-live="polite"
          >
            <LoaderIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{statusHint}</span>
          </div>
        )}

        {errorCode && (
          <div
            className="mb-pos-lg flex items-start gap-pos-sm rounded-pos border border-error/30 bg-error-container px-pos-md py-pos-sm text-body-sm text-error"
            role="alert"
          >
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{t(`licensing.plans.errors.${errorCode}`)}</span>
          </div>
        )}

        <div className="flex items-center justify-between gap-pos-md">
          <button
            type="button"
            className="pos-button pos-button-secondary inline-flex items-center gap-pos-xs"
            onClick={onCancel}
            disabled={isPolling}
          >
            <XIcon className="h-4 w-4" aria-hidden="true" />
            {t("licensing.plans.payment.cancel")}
          </button>
          <button
            type="button"
            className="pos-button pos-button-primary inline-flex items-center gap-pos-xs py-pos-md text-ui font-bold"
            onClick={onRetryOpen}
            disabled={isPolling}
          >
            {t("licensing.plans.payment.open_payment")}
          </button>
        </div>
      </div>
    </section>
  );
};