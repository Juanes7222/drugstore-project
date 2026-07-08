/**
 * OperationQueuedToast — lightweight confirmation toast for offline-first
 * operations that are queued for sync or already synced.
 *
 * Appears after successful local mutations (returns, inventory adjustments,
 * prescription registrations) and auto-dismisses after 5 seconds or on
 * manual close.
 *
 * Visual states:
 *   - Online  → pharma-teal checkmark + "Operation synced"
 *   - Offline → sync-slate checkmark + "Operation queued for sync"
 */
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

export interface OperationQueuedToastProps {
  operationUuid: string;
  operationType: string;
  isVerified?: boolean;
  isOnline: boolean;
  /** Called when the toast auto-dismisses or is manually closed. */
  onDismiss: () => void;
  /** Duration in ms before auto-dismiss. Defaults to 5 000. */
  autoDismissMs?: number;
}

export const OperationQueuedToast: FC<OperationQueuedToastProps> = ({
  operationUuid,
  operationType,
  isVerified = true,
  isOnline,
  onDismiss,
  autoDismissMs = 5_000,
}) => {
  const { t } = useTranslation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [isExiting, setIsExiting] = useState(false);

  const handleClose = useCallback(() => {
    setIsExiting(true);
    setTimeout(onDismiss, 200);
  }, [onDismiss]);

  useEffect(() => {
    timerRef.current = setTimeout(handleClose, autoDismissMs);
    return () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current);
      }
    };
  }, [handleClose, autoDismissMs]);

  const statusLabel = isOnline
    ? t("toast.status_synced")
    : t("toast.status_queued");

  const truncatedUuid =
    operationUuid.length > 8
      ? `${operationUuid.slice(0, 8)}...`
      : operationUuid;

  const typeLabel = t(`toast.operation_type.${operationType}`, {
    defaultValue: operationType,
  });

  return (
    <div
      role="status"
      aria-live="polite"
      className={`pos-toast ${isExiting ? "pos-toast--exiting" : ""}`}
      style={{
        borderLeftColor: isOnline ? "var(--color-pharma)" : "var(--color-sync)",
      }}
    >
      <div className="pos-toast__body">
        <span
          className="pos-toast__icon"
          style={{
            color: isOnline ? "var(--color-pharma)" : "var(--color-sync)",
          }}
          aria-hidden="true"
        >
          <CheckIcon />
        </span>

        <div className="pos-toast__content">
          <span className="pos-toast__title">
            {statusLabel}
          </span>

          <span className="pos-toast__detail">
            {typeLabel}
            {" — "}
            <span className="font-data tabular-nums">{truncatedUuid}</span>
          </span>

          {!isVerified && (
            <span className="pos-toast__warning">
              {t("toast.unverified_tag")}
            </span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={handleClose}
        className="pos-toast__close"
        aria-label={t("common.close")}
      >
        <CloseIcon />
      </button>
    </div>
  );
};

const CheckIcon: FC = () => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M5 13l4 4L19 7" />
  </svg>
);

const CloseIcon: FC = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);
