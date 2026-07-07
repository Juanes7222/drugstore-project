/**
 * Visual state machine for electronic payment authorization.
 *
 * Pending, approved, and rejected each have a distinct treatment so the
 * cashier can tell the outcome at a glance — not only by reading text.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import {
  AuthorizationStatus,
  PaymentMethodEntry,
} from "@/store/slices/payment-types";

interface PaymentStatusBadgeProps {
  method: PaymentMethodEntry;
  onAuthorize: () => void;
  disabled?: boolean;
}

export const PaymentStatusBadge: FC<PaymentStatusBadgeProps> = ({
  method,
  onAuthorize,
  disabled = false,
}) => {
  const { t } = useTranslation();

  if (method.authorizationStatus === AuthorizationStatus.PENDING) {
    return (
      <span className="pos-badge pos-badge-urgency animate-pulse">
        <SpinnerIcon />
        {t("payment.status.pending")}
      </span>
    );
  }

  if (method.authorizationStatus === AuthorizationStatus.APPROVED) {
    return (
      <span
        className="pos-badge"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-pharma) 12%, white)",
          color: "var(--color-pharma)",
        }}
      >
        <CheckIcon />
        {t("payment.status.approved")}
        {method.reference && (
          <span
            className="font-data tabular-nums text-caption"
            style={{
              color: "color-mix(in srgb, var(--color-ink) 50%, transparent)",
            }}
          >
            {method.reference}
          </span>
        )}
      </span>
    );
  }

  if (method.authorizationStatus === AuthorizationStatus.REJECTED) {
    return (
      <div className="flex flex-col gap-pos-xs">
        <span
          className="pos-badge"
          style={{
            backgroundColor: "#FDEDED",
            color: "#D32F2F",
          }}
        >
          <CrossIcon />
          {t("payment.status.rejected")}
        </span>
        {method.rejectionReason && (
          <span
            className="text-caption"
            style={{ color: "color-mix(in srgb, #D32F2F 70%, transparent)" }}
          >
            {method.rejectionReason}
          </span>
        )}
        <button
          type="button"
          onClick={onAuthorize}
          disabled={disabled}
          className="pos-button pos-button-secondary self-start px-pos-sm py-pos-xs text-caption"
        >
          {t("payment.retry")}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onAuthorize}
      disabled={disabled || method.amountCents <= 0}
      className="pos-button pos-button-secondary px-pos-sm py-pos-xs text-caption"
    >
      {t("payment.authorize")}
    </button>
  );
};

const SpinnerIcon: FC = () => (
  <svg
    className="h-3.5 w-3.5 animate-spin"
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
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

const CheckIcon: FC = () => (
  <svg
    className="h-3.5 w-3.5"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={3}
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const CrossIcon: FC = () => (
  <svg
    className="h-3.5 w-3.5"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={3}
    aria-hidden="true"
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M6 18L18 6M6 6l12 12"
    />
  </svg>
);
