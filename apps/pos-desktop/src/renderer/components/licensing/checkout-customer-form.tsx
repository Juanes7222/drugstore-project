/**
 * CheckoutCustomerForm — billing data step of the self-service checkout.
 *
 * Collects the customer identity (name, tax id, email, optional phone),
 * validates it client-side, and shows the plan/period/amount summary before
 * the payment step is submitted.
 *
 * @category Component
 */
import { type FC, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { BillingPeriod } from "@pharmacy/shared-types";
import { AlertTriangleIcon, ArrowLeftIcon, CreditCardIcon } from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import { formatCurrency } from "@/utils/format-currency";

export interface CustomerDraft {
  planCode: string;
  billingPeriod: BillingPeriod;
  customerName: string;
  customerTaxId: string;
  customerEmail: string;
  /** Optional; empty string when not provided. */
  customerPhone: string;
}

export interface CheckoutCustomerFormProps {
  planName: string;
  planCode: string;
  billingPeriod: BillingPeriod;
  amountCents: number;
  isSubmitting: boolean;
  /** "CHECKOUT_CREATE_FAILED" | "CHECKOUT_NETWORK" when the session could not be created. */
  errorCode: string | null;
  onSubmit: (draft: CustomerDraft) => void;
  onBack: () => void;
}

const PERIOD_LABEL_KEY: Record<BillingPeriod, string> = {
  [BillingPeriod.MONTHLY]: "licensing.plans.period.monthly",
  [BillingPeriod.QUARTERLY]: "licensing.plans.period.quarterly",
  [BillingPeriod.ANNUAL]: "licensing.plans.period.annual",
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface FieldErrors {
  customerName: string | null;
  customerTaxId: string | null;
  customerEmail: string | null;
}

const NO_FIELD_ERRORS: FieldErrors = {
  customerName: null,
  customerTaxId: null,
  customerEmail: null,
};

export const CheckoutCustomerForm: FC<CheckoutCustomerFormProps> = ({
  planName,
  planCode,
  billingPeriod,
  amountCents,
  isSubmitting,
  errorCode,
  onSubmit,
  onBack,
}) => {
  const { t } = useTranslation();

  const [customerName, setCustomerName] = useState("");
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(NO_FIELD_ERRORS);

  const validate = useCallback(
    (): FieldErrors => {
      const errors: FieldErrors = { ...NO_FIELD_ERRORS };
      if (customerName.trim().length < 2) {
        errors.customerName = t("licensing.plans.form.errors.name_short");
      }
      if (customerTaxId.trim().length < 5) {
        errors.customerTaxId = t("licensing.plans.form.errors.nit_short");
      }
      if (customerEmail.trim().length === 0) {
        errors.customerEmail = t("licensing.plans.form.errors.required");
      } else if (!EMAIL_PATTERN.test(customerEmail.trim())) {
        errors.customerEmail = t("licensing.plans.form.errors.email_invalid");
      }
      return errors;
    },
    [customerName, customerTaxId, customerEmail, t],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      const errors = validate();
      setFieldErrors(errors);
      if (errors.customerName || errors.customerTaxId || errors.customerEmail) {
        return;
      }
      onSubmit({
        planCode,
        billingPeriod,
        customerName: customerName.trim(),
        customerTaxId: customerTaxId.trim(),
        customerEmail: customerEmail.trim(),
        customerPhone: customerPhone.trim(),
      });
    },
    [validate, onSubmit, planCode, billingPeriod, customerName, customerTaxId, customerEmail, customerPhone],
  );

  return (
    <section
      aria-label={t("licensing.plans.form.title")}
      className="flex h-full flex-col items-center overflow-y-auto bg-surface p-pos-lg"
    >
      <div className="w-full max-w-lg">
        <div className="mb-pos-md flex items-center gap-pos-md">
          <CreditCardIcon className="h-6 w-6 text-pharma" aria-hidden="true" />
          <h1 className="text-heading font-semibold text-ink">
            {t("licensing.plans.form.title")}
          </h1>
        </div>
        <p className="mb-pos-lg text-body text-ink-muted">
          {t("licensing.plans.form.subtitle")}
        </p>

        {/* Summary box — plan, period and amount are the numbers the
            customer confirms before paying, so the amount is mono/tabular. */}
        <div className="mb-pos-lg rounded-pos border border-border bg-panel p-pos-md shadow-pos-panel">
          <dl className="space-y-pos-xs text-body-sm">
            <div className="flex items-center justify-between gap-pos-md">
              <dt className="text-ink-muted">{t("licensing.plans.form.summary_plan")}</dt>
              <dd className="font-semibold text-ink">{planName}</dd>
            </div>
            <div className="flex items-center justify-between gap-pos-md">
              <dt className="text-ink-muted">{t("licensing.plans.form.summary_period")}</dt>
              <dd className="text-ink">{t(PERIOD_LABEL_KEY[billingPeriod])}</dd>
            </div>
            <div className="flex items-center justify-between gap-pos-md border-t border-border pt-pos-xs">
              <dt className="font-medium text-ink">{t("licensing.plans.form.summary_amount")}</dt>
              <dd className="font-data text-price font-semibold tabular-nums text-pharma">
                {formatCurrency(amountCents)}
              </dd>
            </div>
          </dl>
        </div>

        {errorCode && (
          <div
            className="mb-pos-lg flex items-start gap-pos-sm rounded-pos border border-error/30 bg-error-container px-pos-md py-pos-sm text-body-sm text-error"
            role="alert"
          >
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            <span>{t(`licensing.plans.errors.${errorCode}`)}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} noValidate className="pos-panel p-pos-xl">
          <label className="mb-pos-xs block text-body-sm font-semibold text-ink" htmlFor="checkout-name">
            {t("licensing.plans.form.name_label")}
          </label>
          <input
            id="checkout-name"
            type="text"
            autoComplete="name"
            className="pos-input mb-pos-xs w-full"
            value={customerName}
            onChange={(e) => setCustomerName(e.currentTarget.value)}
            disabled={isSubmitting}
            aria-invalid={fieldErrors.customerName !== null}
            aria-describedby={fieldErrors.customerName ? "checkout-name-error" : undefined}
            placeholder={t("licensing.plans.form.name_placeholder")}
          />
          {fieldErrors.customerName && (
            <p id="checkout-name-error" className="mb-pos-sm text-caption text-error" role="alert">
              {fieldErrors.customerName}
            </p>
          )}

          <label className="mb-pos-xs mt-pos-md block text-body-sm font-semibold text-ink" htmlFor="checkout-tax-id">
            {t("licensing.plans.form.nit_label")}
          </label>
          <input
            id="checkout-tax-id"
            type="text"
            autoComplete="off"
            inputMode="numeric"
            className="pos-input mb-pos-xs w-full font-data"
            value={customerTaxId}
            onChange={(e) => setCustomerTaxId(e.currentTarget.value)}
            disabled={isSubmitting}
            aria-invalid={fieldErrors.customerTaxId !== null}
            aria-describedby={fieldErrors.customerTaxId ? "checkout-tax-id-error" : undefined}
            placeholder={t("licensing.plans.form.nit_placeholder")}
          />
          {fieldErrors.customerTaxId && (
            <p id="checkout-tax-id-error" className="mb-pos-sm text-caption text-error" role="alert">
              {fieldErrors.customerTaxId}
            </p>
          )}

          <label className="mb-pos-xs mt-pos-md block text-body-sm font-semibold text-ink" htmlFor="checkout-email">
            {t("licensing.plans.form.email_label")}
          </label>
          <input
            id="checkout-email"
            type="email"
            autoComplete="email"
            className="pos-input mb-pos-xs w-full"
            value={customerEmail}
            onChange={(e) => setCustomerEmail(e.currentTarget.value)}
            disabled={isSubmitting}
            aria-invalid={fieldErrors.customerEmail !== null}
            aria-describedby={fieldErrors.customerEmail ? "checkout-email-error" : undefined}
            placeholder={t("licensing.plans.form.email_placeholder")}
          />
          {fieldErrors.customerEmail && (
            <p id="checkout-email-error" className="mb-pos-sm text-caption text-error" role="alert">
              {fieldErrors.customerEmail}
            </p>
          )}

          <label className="mb-pos-xs mt-pos-md block text-body-sm font-semibold text-ink" htmlFor="checkout-phone">
            {t("licensing.plans.form.phone_label")}
          </label>
          <input
            id="checkout-phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            className="pos-input mb-pos-sm w-full"
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.currentTarget.value)}
            disabled={isSubmitting}
            placeholder={t("licensing.plans.form.phone_placeholder")}
          />

          <div className="mt-pos-lg flex items-center justify-between gap-pos-md">
            <button
              type="button"
              className="pos-button pos-button-secondary inline-flex items-center gap-pos-xs"
              onClick={onBack}
              disabled={isSubmitting}
            >
              <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
              {t("licensing.plans.form.back")}
            </button>
            <button
              type="submit"
              className="pos-button pos-button-primary inline-flex min-w-40 items-center justify-center gap-pos-xs py-pos-md text-ui font-bold"
              disabled={isSubmitting}
              aria-busy={isSubmitting}
            >
              {isSubmitting && (
                <LoaderIcon className="h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              {isSubmitting ? t("licensing.plans.form.submitting") : t("licensing.plans.form.submit")}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};