/**
 * CheckoutResult — terminal state of the self-service checkout.
 *
 * Approved: shows the activation code prominently (grouped mono blocks with
 * a copy button) and offers activation, dismissal or browsing plans again.
 * Declined: failure panel with retry. Timeout: pending panel — the payment
 * may still resolve server-side, so "retry" reopens the same session.
 *
 * @category Component
 */
import { type FC, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ClockIcon, ClipboardListIcon, ShieldIcon, XCircleIcon } from "@/components/ui/icons";
import { SuccessCheckIcon } from "@/components/ui/icons/animated";
import { formatActivationCode } from "./activation.helpers";

export type CheckoutResultKind = "approved" | "declined" | "timeout";

export interface CheckoutResultProps {
  kind: CheckoutResultKind;
  activationCode: string | null;
  /**
   * True when the approved plan bills with the customer's own DIAN
   * certificate — the result panel then previews the certificate step
   * that follows activation.
   */
  requiresCertificate?: boolean;
  onActivate: () => void;
  onRetryPayment: () => void;
  onRestart: () => void;
  onDismissCode: () => void;
}

/** Fallback copy path for non-secure contexts where the Clipboard API is unavailable. */
const copyWithFallback = (text: string): boolean => {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  return copied;
};

const copyToClipboard = async (text: string): Promise<boolean> => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return copyWithFallback(text);
  }
};

/** Split a formatted activation code ("ABCD-EFGH-IJKL") into its groups. */
const groupActivationCode = (formatted: string): string[] => formatted.split("-");

export const CheckoutResult: FC<CheckoutResultProps> = ({
  kind,
  activationCode,
  requiresCertificate,
  onActivate,
  onRetryPayment,
  onRestart,
  onDismissCode,
}) => {
  const { t } = useTranslation();
  const [isCopied, setIsCopied] = useState(false);

  // Reset the "copied" feedback after a moment so the button reads normally
  // for the next interaction.
  useEffect(() => {
    if (!isCopied) return;
    const timeoutId = setTimeout(() => setIsCopied(false), 2_000);
    return () => clearTimeout(timeoutId);
  }, [isCopied]);

  const handleCopy = useCallback(async () => {
    if (!activationCode) return;
    const formatted = formatActivationCode(activationCode);
    const copied = await copyToClipboard(formatted);
    setIsCopied(copied);
  }, [activationCode]);

  const formattedCode = activationCode ? formatActivationCode(activationCode) : null;
  const codeGroups = formattedCode ? groupActivationCode(formattedCode) : [];

  if (kind === "approved") {
    return (
      <section
        aria-label={t("licensing.plans.result.approved.title")}
        className="flex h-full flex-col items-center justify-center bg-surface p-pos-lg"
      >
        <div
          className="w-full max-w-lg rounded-pos border border-pharma/30 bg-panel p-pos-xl text-center shadow-pos-panel"
          role="status"
        >
          <SuccessCheckIcon
            size={48}
            className="mx-auto mb-pos-md text-pharma"
            aria-hidden="true"
          />
          <h1 className="mb-pos-sm text-heading font-semibold text-ink">
            {t("licensing.plans.result.approved.title")}
          </h1>
          <p className="mb-pos-lg text-body text-ink-muted">
            {t("licensing.plans.result.approved.body")}
          </p>

          {requiresCertificate && (
            <div
              className="mb-pos-md rounded-pos border px-pos-md py-pos-sm text-left"
              role="note"
              style={{
                backgroundColor: "var(--color-restrict-surface)",
                borderColor:
                  "color-mix(in srgb, var(--color-restrict) 35%, transparent)",
                borderLeft: `4px solid var(--color-restrict)`,
              }}
            >
              <p
                className="mb-pos-xs flex items-center gap-pos-xs text-caption font-bold uppercase tracking-wide"
                style={{ color: "var(--color-restrict)" }}
              >
                <ShieldIcon className="h-4 w-4" aria-hidden="true" />
                {t("licensing.plans.result.approved.certificate_note_title")}
              </p>
              <p className="text-body-sm text-ink">
                {t("licensing.plans.result.approved.certificate_note")}
              </p>
            </div>
          )}

          {activationCode ? (
            <>
              <p className="mb-pos-xs text-caption font-medium uppercase tracking-wide text-ink-muted">
                {t("licensing.plans.result.code_label")}
              </p>

              {/* Activation code — the one datum the customer carries away,
                  so it gets the full mono/tabular data treatment. */}
              <div
                className="mx-auto mb-pos-md flex max-w-md flex-wrap items-center justify-center gap-pos-xs rounded-pos border border-border bg-surface p-pos-md"
                aria-label={formattedCode ?? undefined}
              >
                {codeGroups.map((group, index) => (
                  <span
                    key={`${group}-${index}`}
                    className="font-data text-price font-semibold tracking-widest text-ink"
                  >
                    {group}
                  </span>
                ))}
              </div>

              <button
                type="button"
                className="pos-button pos-button-secondary mx-auto mb-pos-md inline-flex items-center gap-pos-xs"
                onClick={handleCopy}
                aria-live="polite"
              >
                <ClipboardListIcon className="h-4 w-4" aria-hidden="true" />
                {isCopied
                  ? t("licensing.plans.result.copied")
                  : t("licensing.plans.result.copy")}
              </button>

              <div className="space-y-pos-sm">
                <button
                  type="button"
                  className="pos-button pos-button-primary w-full py-pos-md text-ui font-bold"
                  onClick={onActivate}
                >
                  {t("licensing.plans.result.activate")}
                </button>
                <button
                  type="button"
                  className="w-full py-pos-sm text-body-sm font-medium text-ink-muted transition-colors hover:text-ink"
                  onClick={onDismissCode}
                >
                  {t("licensing.plans.result.dismiss")}
                </button>
                <button
                  type="button"
                  className="w-full py-pos-xs text-caption text-ink-muted transition-colors hover:text-ink"
                  onClick={onRestart}
                >
                  {t("licensing.plans.result.restart")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-pos-lg text-body text-ink-muted">
                {t("licensing.plans.result.approved.no_code_body")}
              </p>
              <button
                type="button"
                className="pos-button pos-button-primary w-full py-pos-md text-ui font-bold"
                onClick={onRestart}
              >
                {t("licensing.plans.result.restart")}
              </button>
            </>
          )}
        </div>
      </section>
    );
  }

  if (kind === "declined") {
    return (
      <section
        aria-label={t("licensing.plans.result.declined.title")}
        className="flex h-full flex-col items-center justify-center bg-surface p-pos-lg"
      >
        <div
          className="w-full max-w-lg rounded-pos border border-error/30 bg-panel p-pos-xl text-center shadow-pos-panel"
          role="alert"
        >
          <XCircleIcon className="mx-auto mb-pos-md h-12 w-12 text-error" aria-hidden="true" />
          <h1 className="mb-pos-sm text-heading font-semibold text-ink">
            {t("licensing.plans.result.declined.title")}
          </h1>
          <p className="mb-pos-lg text-body text-ink-muted">
            {t("licensing.plans.result.declined.body")}
          </p>
          <div className="space-y-pos-sm">
            <button
              type="button"
              className="pos-button pos-button-primary w-full py-pos-md text-ui font-bold"
              onClick={onRetryPayment}
            >
              {t("licensing.plans.result.retry_payment")}
            </button>
            <button
              type="button"
              className="w-full py-pos-sm text-body-sm font-medium text-ink-muted transition-colors hover:text-ink"
              onClick={onRestart}
            >
              {t("licensing.plans.result.restart")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={t("licensing.plans.result.timeout.title")}
      className="flex h-full flex-col items-center justify-center bg-surface p-pos-lg"
    >
      <div
        className="w-full max-w-lg rounded-pos border border-sync/30 bg-panel p-pos-xl text-center shadow-pos-panel"
        role="status"
        aria-live="polite"
      >
        <ClockIcon className="mx-auto mb-pos-md h-12 w-12 text-sync" aria-hidden="true" />
        <h1 className="mb-pos-sm text-heading font-semibold text-ink">
          {t("licensing.plans.result.timeout.title")}
        </h1>
        <p className="mb-pos-lg text-body text-ink-muted">
          {t("licensing.plans.result.timeout.body")}
        </p>
        <div className="space-y-pos-sm">
          <button
            type="button"
            className="pos-button pos-button-primary w-full py-pos-md text-ui font-bold"
            onClick={onRetryPayment}
          >
            {t("licensing.plans.result.verify_payment")}
          </button>
          <button
            type="button"
            className="w-full py-pos-sm text-body-sm font-medium text-ink-muted transition-colors hover:text-ink"
            onClick={onRestart}
          >
            {t("licensing.plans.result.restart")}
          </button>
        </div>
      </div>
    </section>
  );
};