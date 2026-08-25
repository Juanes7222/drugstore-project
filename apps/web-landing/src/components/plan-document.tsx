import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { BillingPeriod } from '@pharmacy/shared-types';
import type { PlanView } from '../data/plans';
import {
  calculatePeriodPriceCents,
  formatCOP,
  periodMonths,
} from '../lib/format';
import { usePrintReveal } from '../hooks/use-print-reveal';
import { BadgeCheckIcon, LandmarkIcon } from './icons';
import { useCheckoutStore } from '../stores/checkout-store';

interface PlanDocumentProps {
  plan: PlanView;
  period: BillingPeriod;
  /** Stagger for the second document's print animation, in ms. */
  revealDelayMs?: number;
}

const SUFFIX_KEY: Record<BillingPeriod, string> = {
  MONTHLY: 'pricing.total_suffix_monthly',
  QUARTERLY: 'pricing.total_suffix_quarterly',
  ANNUAL: 'pricing.total_suffix_annual',
};

/**
 * One plan rendered as a fiscal document — the site's signature element.
 * Both documents are deliberately identical except for the highlighted DIAN
 * block, mirroring exactly how the two plans differ in the system.
 */
export function PlanDocument({ plan, period, revealDelayMs = 0 }: PlanDocumentProps) {
  const { t } = useTranslation();
  const openCheckout = useCheckoutStore((state) => state.openCheckout);
  const revealRef = usePrintReveal<HTMLElement>();

  const isProvider = plan.billingMethod === 'PROVIDER';
  const totalCents = calculatePeriodPriceCents(plan.basePriceCents, period);
  const perMonthCents = Math.round(totalCents / periodMonths(period));

  return (
    <article
      ref={revealRef}
      data-printed="false"
      className="print-reveal perforation relative flex flex-col rounded-t-xl border border-tinta/20 bg-white"
      style={
        {
          '--perforation-bg': 'var(--color-menta)',
          transitionDelay: `${revealDelayMs}ms`,
        } as CSSProperties
      }
    >
      <div className="flex flex-1 flex-col p-6 sm:p-8">
        {/* Document header */}
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="eyebrow text-verde-cruz">{t('pricing.doc_heading')}</h3>
          <span className="data text-xs text-tinta-media">PF·{plan.code}</span>
        </div>
        <p className="mt-1 text-[11px] text-tinta-media">{t('pricing.doc_disclaimer')}</p>

        <p className="display mt-4 text-xl font-bold">{plan.name}</p>
        {plan.description ? (
          <p className="mt-1 text-sm leading-relaxed text-tinta-media">{plan.description}</p>
        ) : null}

        {/* Concept rows */}
        <table className="mt-5 w-full text-sm">
          <thead className="sr-only">
            <tr>
              <th scope="col">{t('pricing.row_license')}</th>
              <th scope="col">{t('pricing.value_support')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-tinta/10">
            <tr>
              <th scope="row" className="py-2.5 pr-4 text-left font-normal text-tinta-media">
                {t('pricing.row_license')}
              </th>
              <td className="data py-2.5 text-right">
                {t('pricing.value_license', { amount: formatCOP(plan.basePriceCents) })}
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-2.5 pr-4 text-left font-normal text-tinta-media">
                {t('pricing.row_workstations')}
              </th>
              <td className="data py-2.5 text-right">{t('pricing.value_workstations')}</td>
            </tr>
            <tr>
              <th scope="row" className="py-2.5 pr-4 text-left font-normal text-tinta-media">
                {t('pricing.row_extra_workstation')}
              </th>
              <td className="data py-2.5 text-right">
                {plan.extraWorkstationPriceCents !== null
                  ? t('pricing.value_extra_workstation', {
                      amount: formatCOP(plan.extraWorkstationPriceCents),
                    })
                  : '—'}
              </td>
            </tr>
            <tr>
              <th scope="row" className="py-2.5 pr-4 text-left font-normal text-tinta-media">
                {t('pricing.row_locations')}
              </th>
              <td className="data py-2.5 text-right">{t('pricing.value_locations')}</td>
            </tr>
            <tr>
              <th scope="row" className="py-2.5 pr-4 text-left font-normal text-tinta-media">
                {t('pricing.row_support')}
              </th>
              <td className="data py-2.5 text-right">{t('pricing.value_support')}</td>
            </tr>
          </tbody>
        </table>

        {/* The one honest difference between the plans */}
        <div className="mb-6 mt-5 rounded-lg border-l-4 border-verde-cruz bg-menta p-4">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-verde-cruz-oscuro uppercase">
            <LandmarkIcon className="text-base" />
            {t('pricing.dian_section_title')}
          </p>
          <p className="mt-2 font-semibold">{isProvider
            ? t('pricing.dian_provider_title')
            : t('pricing.dian_certificate_title')}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-verde-cruz-oscuro/85">
            {isProvider ? t('pricing.dian_provider_body') : t('pricing.dian_certificate_body')}
          </p>
        </div>

        {/* Total — pinned to the bottom so both twins align across columns */}
        <div className="mt-auto border-t border-dashed border-tinta/30 pt-4">
          <div className="flex items-baseline justify-between">
            <span className="display font-bold">{t('pricing.total_row')}</span>
            <span className="data text-2xl font-semibold">
              {formatCOP(totalCents)}{' '}
              <span className="text-sm font-normal text-tinta-media">
                {t(SUFFIX_KEY[period])}
              </span>
            </span>
          </div>
          {period !== 'MONTHLY' && (
            <p className="data mt-1 text-right text-xs text-tinta-media">
              {t('pricing.per_month_equivalent', { amount: formatCOP(perMonthCents) })}
            </p>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary mt-6 w-full"
          onClick={() => openCheckout(plan.code, period)}
        >
          {t('pricing.doc_cta')}
        </button>
      </div>

      {/* Included-everything line doubles as the perforation's visual anchor */}
      <p className="data flex items-start justify-center gap-2 px-6 pb-7 text-center text-xs text-tinta-media">
        <BadgeCheckIcon className="mt-0.5 shrink-0 text-sm text-verde-cruz" />
        <span>{t('pricing.all_features_note')}</span>
      </p>
    </article>
  );
}
