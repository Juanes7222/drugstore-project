import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { calculatePeriodPriceCents, formatCOP, periodMonths } from '../lib/format';
import { useCheckoutStore } from '../stores/checkout-store';
import { usePlansStore } from '../stores/plans-store';

/**
 * Mobile-only sticky buy bar. Appears once the hero scrolls out of view so the
 * primary CTA is always one thumb-tap away; the pricing section selector keeps
 * controlling which total it quotes. Desktop never renders it (md:hidden).
 */
export function MobileBuyBar() {
  const { t } = useTranslation();
  const openCheckout = useCheckoutStore((state) => state.openCheckout);
  const billingPeriod = useCheckoutStore((state) => state.billingPeriod);
  const livePlans = usePlansStore((state) => state.plans);
  const [heroScrolledPast, setHeroScrolledPast] = useState(false);

  useEffect(() => {
    const hero = document.getElementById('inicio');
    if (!hero || typeof IntersectionObserver === 'undefined') {
      setHeroScrolledPast(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setHeroScrolledPast(!entry.isIntersecting),
      // Require most of the hero to be gone before the bar claims the screen.
      { threshold: 0.9 },
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  const basePriceCents = livePlans[0].basePriceCents;
  const monthlyEquivalentCents = Math.round(
    calculatePeriodPriceCents(basePriceCents, billingPeriod) / periodMonths(billingPeriod),
  );

  return (
    <div
      data-visible={heroScrolledPast}
      aria-label={t('mobile_bar.label')}
      className="mobile-buy-bar border-t border-tinta/15 bg-papel/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-sm md:hidden"
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <p className="min-w-0">
          <span className="data block text-base font-semibold">
            {formatCOP(monthlyEquivalentCents)}
            <span className="ml-1 text-xs font-normal text-tinta-media">
              {t('mobile_bar.price_note')}
            </span>
          </span>
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm shrink-0"
          onClick={() => openCheckout('PROVIDER', billingPeriod)}
        >
          {t('nav.buy')}
        </button>
      </div>
    </div>
  );
}
