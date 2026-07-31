/**
 * Visual state machine for electronic payment authorization.
 *
 * Pending, approved, and rejected each have a distinct treatment so the
 * cashier can tell the outcome at a glance — not only by reading text.
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import {
import { CheckIcon, XIcon } from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
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
  <LoaderIcon className="h-3.5 w-3.5" />
);

const CheckIcon: FC = () => (
  <CheckIcon className="h-3.5 w-3.5" strokeWidth={3} />
);

const CrossIcon: FC = () => (
  <XIcon className="h-3.5 w-3.5" strokeWidth={3} />
);
