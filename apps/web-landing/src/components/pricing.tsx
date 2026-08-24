import { useTranslation } from 'react-i18next';
import { BillingPeriod } from '@pharmacy/shared-types';
import { PUBLIC_PLANS } from '../data/plans';
import { PlanDocument } from './plan-document';
import { useCheckoutStore } from '../stores/checkout-store';

const PERIOD_OPTIONS: BillingPeriod[] = [BillingPeriod.MONTHLY, BillingPeriod.QUARTERLY, BillingPeriod.ANNUAL];

const PERIOD_LABEL_KEY: Record<BillingPeriod, string> = {
  MONTHLY: 'pricing.period_monthly',
  QUARTERLY: 'pricing.period_quarterly',
  ANNUAL: 'pricing.period_annual',
};

/**
 * Pricing band on the menta background: period selector + the two twin plan
 * documents, then the workstation/payment notes.
 */
export function Pricing() {
  const { t } = useTranslation();
  const billingPeriod = useCheckoutStore((state) => state.billingPeriod);
  const setBillingPeriod = useCheckoutStore((state) => state.setBillingPeriod);

  return (
    <section id="planes" aria-labelledby="pricing-title" className="bg-menta py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="max-w-2xl">
          <p className="eyebrow text-verde-cruz">{t('pricing.eyebrow')}</p>
          <h2 id="pricing-title" className="display mt-4 text-3xl font-bold sm:text-4xl">
            {t('pricing.title')}
          </h2>
          <p className="mt-4 leading-relaxed text-tinta-media">{t('pricing.subtitle')}</p>
        </div>

        {/* Period selector — native radios keep keyboard arrows working */}
        <fieldset className="mt-10">
          <legend className="eyebrow text-tinta-media">{t('pricing.period_label')}</legend>
          <div className="mt-3 inline-flex flex-wrap gap-2 rounded-lg border border-tinta/20 bg-white p-1.5">
            {PERIOD_OPTIONS.map((period) => (
              <label key={period} className="relative">
                <input
                  type="radio"
                  name="billing-period"
                  value={period}
                  checked={billingPeriod === period}
                  onChange={() => setBillingPeriod(period)}
                  className="peer sr-only"
                />
                <span className="data block cursor-pointer rounded-md px-4 py-2 text-sm font-medium text-tinta-media peer-checked:bg-verde-cruz peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-verde-cruz peer-focus-visible:outline-offset-2">
                  {t(PERIOD_LABEL_KEY[period])}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* The twin documents */}
        <div className="mx-auto mt-14 grid max-w-4xl gap-x-10 gap-y-12 md:grid-cols-2">
          {PUBLIC_PLANS.map((plan, index) => (
            <PlanDocument
              key={plan.code}
              plan={plan}
              period={billingPeriod}
              revealDelayMs={index === 1 ? 150 : 0}
            />
          ))}
        </div>

        <div className="mx-auto mt-14 max-w-2xl space-y-2 text-center text-sm text-tinta-media">
          <p>{t('pricing.workstation_note')}</p>
          <p>{t('pricing.payment_note')}</p>
        </div>
      </div>
    </section>
  );
}
