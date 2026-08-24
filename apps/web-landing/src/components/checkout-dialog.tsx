import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { BillingPeriod } from '@pharmacy/shared-types';
import { PUBLIC_PLANS } from '../data/plans';
import { calculatePeriodPriceCents, formatCOP } from '../lib/format';
import { useCheckoutStore } from '../stores/checkout-store';
import { XIcon } from './icons';

type CheckoutError =
  | 'error_api_not_configured'
  | 'error_network'
  | 'error_invalid'
  | 'error_generic';

const PERIOD_LABEL_KEY: Record<BillingPeriod, string> = {
  MONTHLY: 'pricing.period_monthly',
  QUARTERLY: 'pricing.period_quarterly',
  ANNUAL: 'pricing.period_annual',
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
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerTaxId, setCustomerTaxId] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CheckoutError | null>(null);

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
      closeCheckout();
    };
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [closeCheckout]);

  const handleBackdropClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === dialogRef.current) {
      dialogRef.current?.close();
    }
  };

  const plan = PUBLIC_PLANS.find((candidate) => candidate.code === planCode);
  const totalCents = plan ? calculatePeriodPriceCents(plan.basePriceCents, billingPeriod) : 0;
  const apiBaseUrl = import.meta.env.VITE_API_URL as string | undefined;

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    if (!form.checkValidity()) {
      form.reportValidity();
      setErrorKey('error_invalid');
      return;
    }
    if (!apiBaseUrl) {
      setErrorKey('error_api_not_configured');
      return;
    }

    setSubmitting(true);
    setErrorKey(null);

    try {
      const response = await fetch(
        `${apiBaseUrl.replace(/\/$/, '')}/public/licensing/checkout/create-session`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            planCode,
            billingPeriod,
            customerName: customerName.trim(),
            customerEmail: customerEmail.trim(),
            customerTaxId: customerTaxId.trim(),
            ...(customerPhone.trim() ? { customerPhone: customerPhone.trim() } : {}),
          }),
        },
      );

      if (!response.ok) {
        setErrorKey('error_generic');
        setSubmitting(false);
        return;
      }

      const data = (await response.json()) as CreateSessionResponse;
      window.location.assign(data.checkoutUrl);
      // Keep the submitting state while the browser navigates to Wompi.
    } catch {
      setErrorKey('error_network');
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
      <form onSubmit={handleSubmit} className="p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="checkout-title" className="display text-xl font-bold">
              {t('checkout.title')}
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-tinta-media">
              {t('checkout.subtitle')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('checkout.cancel')}
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
            {t('checkout.total_summary', { amount: formatCOP(totalCents) })}
          </p>
        </div>

        <div className="mt-5 space-y-4">
          <Field label={t('checkout.field_name')}>
            <input
              type="text"
              required
              minLength={2}
              maxLength={300}
              autoComplete="name"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
              className="w-full rounded-md border border-tinta/25 px-3 py-2.5"
              disabled={submitting}
            />
          </Field>
          <Field label={t('checkout.field_email')}>
            <input
              type="email"
              required
              maxLength={254}
              autoComplete="email"
              value={customerEmail}
              onChange={(event) => setCustomerEmail(event.target.value)}
              className="w-full rounded-md border border-tinta/25 px-3 py-2.5"
              disabled={submitting}
            />
          </Field>
          <Field label={t('checkout.field_tax_id')}>
            <input
              type="text"
              required
              minLength={3}
              maxLength={50}
              value={customerTaxId}
              onChange={(event) => setCustomerTaxId(event.target.value)}
              className="data w-full rounded-md border border-tinta/25 px-3 py-2.5"
              disabled={submitting}
            />
          </Field>
          <Field label={t('checkout.field_phone')}>
            <input
              type="tel"
              maxLength={30}
              autoComplete="tel"
              value={customerPhone}
              onChange={(event) => setCustomerPhone(event.target.value)}
              className="data w-full rounded-md border border-tinta/25 px-3 py-2.5"
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
          {submitting ? t('checkout.submitting') : t('checkout.submit')}
        </button>
        <p className="mt-3 text-center text-xs text-tinta-media">
          {t('checkout.redirect_note')}
        </p>
      </form>
    </dialog>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
