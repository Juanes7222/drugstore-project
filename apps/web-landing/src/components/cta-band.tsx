import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { BillingPeriod } from '@pharmacy/shared-types';
import { calculatePeriodPriceCents, formatCOP } from '../lib/format';
import { usePrintReveal } from '../hooks/use-print-reveal';
import { ArrowRightIcon, LogoMark } from './icons';
import { useCheckoutStore } from '../stores/checkout-store';
import { usePlansStore } from '../stores/plans-store';

const PERIOD_LABEL_KEY: Record<BillingPeriod, string> = {
  MONTHLY: 'pricing.period_monthly',
  QUARTERLY: 'pricing.period_quarterly',
  ANNUAL: 'pricing.period_annual',
};

const TOTAL_SUFFIX_KEY: Record<BillingPeriod, string> = {
  MONTHLY: 'pricing.total_suffix_monthly',
  QUARTERLY: 'pricing.total_suffix_quarterly',
  ANNUAL: 'pricing.total_suffix_annual',
};

/**
 * Final CTA rendered as a thermal receipt (tirilla) — the site's fiscal-document
 * signature carried to the last moment before conversion. The total always
 * mirrors the billing period chosen in the pricing section.
 */
export function CtaBand() {
  const { t } = useTranslation();
  const openCheckout = useCheckoutStore((state) => state.openCheckout);
  const billingPeriod = useCheckoutStore((state) => state.billingPeriod);
  const livePlans = usePlansStore((state) => state.plans);
  const revealRef = usePrintReveal<HTMLElement>();

  // Both plans share the same price; the receipt quotes whichever plan is
  // first in the effective catalog (seed or server).
  const basePriceCents = livePlans[0].basePriceCents;
  const totalCents = calculatePeriodPriceCents(basePriceCents, billingPeriod);

  return (
    <section aria-labelledby="cta-title" className="bg-verde-cruz py-20 lg:py-24">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <h2
          id="cta-title"
          className="display text-center text-3xl font-bold text-white sm:text-4xl"
        >
          {t('cta_band.title')}
        </h2>

        <article
          ref={revealRef}
          data-printed="false"
          className="print-reveal perforation mx-auto mt-10 max-w-sm rounded-t-xl border border-tinta/20 bg-white p-6 sm:p-7"
          style={{ '--perforation-bg': 'var(--color-verde-cruz)' } as CSSProperties}
        >
          {/* Receipt header */}
          <div className="flex items-baseline justify-between gap-3">
            <p className="flex items-center gap-2 font-semibold text-tinta">
              <LogoMark className="text-lg text-verde-cruz" />
              <span className="display text-base">{t('brand.name')}</span>
            </p>
            <span className="data text-xs text-tinta-media">PF·LIC</span>
          </div>
          <p className="mt-1 border-b border-dashed border-tinta/30 pb-3 text-[11px] text-tinta-media">
            {t('cta_band.doc_title')}
          </p>

          {/* Concept rows */}
          <dl className="space-y-2 pt-3 text-sm">
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-tinta-media">{t('cta_band.doc_line_sedes')}</dt>
              <dd className="data shrink-0">✓</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-tinta-media">{t('cta_band.doc_line_features')}</dt>
              <dd className="data shrink-0">✓</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-tinta-media">{t('pricing.row_support')}</dt>
              <dd className="data shrink-0">{t('pricing.value_support')}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-tinta-media">{t('pricing.period_label')}</dt>
              <dd className="data shrink-0">{t(PERIOD_LABEL_KEY[billingPeriod])}</dd>
            </div>
          </dl>

          {/* Total */}
          <div className="mt-4 flex items-baseline justify-between border-t border-dashed border-tinta/30 pt-4">
            <span className="display font-bold">{t('cta_band.total_row')}</span>
            <span className="data text-xl font-semibold">
              {formatCOP(totalCents)}{' '}
              <span className="text-xs font-normal text-tinta-media">
                {t(TOTAL_SUFFIX_KEY[billingPeriod])}
              </span>
            </span>
          </div>

          <button
            type="button"
            className="btn btn-primary mt-5 w-full"
            onClick={() => openCheckout('PROVIDER', billingPeriod)}
          >
            {t('cta_band.button')}
            <ArrowRightIcon className="btn-arrow text-base" />
          </button>

          <p className="mt-3 text-center text-xs text-tinta-media">{t('cta_band.note')}</p>
        </article>
      </div>
    </section>
  );
}
