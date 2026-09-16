import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import type { BillingPeriod } from "@pharmacy/shared-types";
import { calculatePeriodPriceCents, formatCOP } from "../lib/format";
import { useCheckoutStore } from "../stores/checkout-store";
import { usePlansStore } from "../stores/plans-store";
import { XIcon } from "./icons";

type CheckoutError =
  | "error_api_not_configured"
  | "error_network"
  | "error_invalid"
  | "error_generic";

const PERIOD_LABEL_KEY: Record<BillingPeriod, string> = {
  MONTHLY: "pricing.period_monthly",
  QUARTERLY: "pricing.period_quarterly",
  ANNUAL: "pricing.period_annual",
};

interface CreateSessionResponse {
  checkoutUrl: string;
}

/**
 * License purchase dialog. Collects the customer data the server's public
 * checkout endpoint requires (Zod-validated there), then redirects to the
 * Wompi payment link it returns.
 */
export function CheckoutDialog() {
  const { t } = useTranslation();
  const isOpen = useCheckoutStore((state) => state.isOpen);
  const planCode = useCheckoutStore((state) => state.planCode);
  const billingPeriod = useCheckoutStore((state) => state.billingPeriod);
  const closeCheckout = useCheckoutStore((state) => state.closeCheckout);

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CheckoutError | null>(null);
  /** Per-field messages, rendered below each field (error-placement rule). */
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) {
      dialog.showModal();
    } else if (!isOpen && dialog.open) {
      dialog.close();
    }
  }, [isOpen]);

  // Escape triggers `cancel` + native close; react to the close event so the
  // store stays in sync no matter how the dialog closed.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      setSubmitting(false);
      setErrorKey(null);
      setFieldErrors({});
      closeCheckout();
    };
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [closeCheckout]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  };

  const plan = usePlansStore((state) => state.plans).find(
    (candidate) => candidate.code === planCode,
  );
  const totalCents = plan
    ? calculatePeriodPriceCents(plan.basePriceCents, billingPeriod)
    : 0;
  const apiBaseUrl = import.meta.env.VITE_API_URL as string | undefined;

  /** Maps native constraint violations to one message per failed field. */
  const collectFieldErrors = (
    form: HTMLFormElement,
  ): Record<string, string> => {
    const errors: Record<string, string> = {};
    for (const input of Array.from(
      form.querySelectorAll<HTMLInputElement>("input"),
    )) {
      if (input.validity.valid) continue;
      errors[input.name] = input.validity.valueMissing
        ? t("checkout.field_error_required")
        : t("checkout.field_error_format");
    }
    return errors;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    if (!form.checkValidity()) {
      const errors = collectFieldErrors(form);
      setFieldErrors(errors);
      setErrorKey("error_invalid");
      // focus-management: keyboard users land on the first invalid field.
      form
        .querySelector<HTMLInputElement>('input[aria-invalid="true"]')
        ?.focus();
      return;
    }
    if (!apiBaseUrl) {
      setErrorKey("error_api_not_configured");
      return;
    }

    setSubmitting(true);
    setErrorKey(null);

    try {
      const response = await fetch(
        `${apiBaseUrl.replace(/\/$/, "")}/public/licensing/checkout/create-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planCode,
            billingPeriod,
            customerName: customerName.trim(),
            customerEmail: customerEmail.trim(),
            customerTaxId: customerTaxId.trim(),
            ...(customerPhone.trim()
              ? { customerPhone: customerPhone.trim() }
              : {}),
          }),
        },
      );

      if (!response.ok) {
        setErrorKey("error_generic");
        setSubmitting(false);
        return;
      }

      const data = (await response.json()) as CreateSessionResponse;
      window.location.assign(data.checkoutUrl);
      // Keep the submitting state while the browser navigates to Wompi.
    } catch {
      setErrorKey("error_network");
      setSubmitting(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="checkout-title"
      onClick={handleBackdropClick}
      className="dialog-panel m-auto w-[min(28rem,calc(100%-2rem))] rounded-xl border border-tinta/20 bg-white p-0 text-tinta shadow-xl backdrop:bg-tinta/50 backdrop:backdrop-blur-[2px]"
    >
      <form onSubmit={handleSubmit} noValidate className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="checkout-title" className="display text-xl font-bold">
              {t("checkout.title")}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-tinta-media">
              {t("checkout.subtitle")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("checkout.cancel")}
            className="btn btn-secondary border-transparent px-2 py-2 text-lg"
            onClick={() => dialogRef.current?.close()}
          >
            <XIcon />
          </button>
        </div>

        {/* Order summary */}
        <div className="mt-5 rounded-lg bg-papel p-4">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{plan?.name ?? planCode}</span>
            <span>{t(PERIOD_LABEL_KEY[billingPeriod])}</span>
          </div>
          <p className="data mt-2 text-right text-lg font-semibold">
            {t("checkout.total_summary", { amount: formatCOP(totalCents) })}
          </p>
        </div>

        <div className="mt-5 space-y-4">
          <Field
            label={t("checkout.field_name")}
            htmlFor="checkout-name"
            required
            error={fieldErrors.customerName}
          >
            <input
              id="checkout-name"
              name="customerName"
              type="text"
              required
              minLength={2}
              maxLength={300}
              autoComplete="name"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              aria-invalid={fieldErrors.customerName ? true : undefined}
              aria-describedby={
                fieldErrors.customerName ? "checkout-name-error" : undefined
              }
              className={`w-full rounded-md border px-3 py-2.5 min-h-11 ${
                fieldErrors.customerName ? "border-error" : "border-tinta/25"
              }`}
              disabled={submitting}
            />
          </Field>
          <Field
            label={t("checkout.field_email")}
            htmlFor="checkout-email"
            required
            error={fieldErrors.customerEmail}
          >
            <input
              id="checkout-email"
              name="customerEmail"
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              aria-invalid={fieldErrors.customerEmail ? true : undefined}
              aria-describedby={
                fieldErrors.customerEmail ? "checkout-email-error" : undefined
              }
              className={`w-full rounded-md border px-3 py-2.5 min-h-11 ${
                fieldErrors.customerEmail ? "border-error" : "border-tinta/25"
              }`}
              disabled={submitting}
            />
          </Field>
          <Field
            label={t("checkout.field_tax_id")}
            htmlFor="checkout-tax-id"
            required
            error={fieldErrors.customerTaxId}
          >
            <input
              id="checkout-tax-id"
              name="customerTaxId"
              type="text"
              required
              minLength={3}
              maxLength={50}
              value={customerTaxId}
              onChange={(event) => setCustomerTaxId(event.target.value)}
              aria-invalid={fieldErrors.customerTaxId ? true : undefined}
              aria-describedby={
                fieldErrors.customerTaxId ? "checkout-tax-id-error" : undefined
              }
              className={`data w-full rounded-md border px-3 py-2.5 min-h-11 ${
                fieldErrors.customerTaxId ? "border-error" : "border-tinta/25"
              }`}
              disabled={submitting}
            />
          </Field>
          <Field
            label={t("checkout.field_phone")}
            htmlFor="checkout-phone"
            error={fieldErrors.customerPhone}
          >
            <input
              id="checkout-phone"
              name="customerPhone"
              type="tel"
              maxLength={30}
              autoComplete="tel"
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
              aria-invalid={fieldErrors.customerPhone ? true : undefined}
              aria-describedby={
                fieldErrors.customerPhone ? "checkout-phone-error" : undefined
              }
              className={`data w-full rounded-md border px-3 py-2.5 min-h-11 ${
                fieldErrors.customerPhone ? "border-error" : "border-tinta/25"
              }`}
              disabled={submitting}
            />
          </Field>
        </div>

        {errorKey && (
          <p
            role="alert"
            className="mt-5 rounded-lg border-l-4 border-error bg-error-fondo px-4 py-3 text-sm text-error"
          >
            {t(`checkout.${errorKey}`)}
          </p>
        )}

        <button
          type="submit"
          className="btn btn-primary mt-6 w-full"
          disabled={submitting}
        >
          {submitting ? t("checkout.submitting") : t("checkout.submit")}
        </button>
        <p className="mt-3 text-center text-xs text-tinta-media">
          {t("checkout.redirect_note")}
        </p>
      </form>
    </dialog>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  children: ReactNode;
  required?: boolean;
  error?: string;
}

function Field({ label, htmlFor, children, required, error }: FieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium">
        {label}
        {required && (
          <span aria-hidden="true" className="text-error">
            {" "}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1.5 text-xs text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
