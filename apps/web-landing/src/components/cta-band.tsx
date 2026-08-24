import { useTranslation } from 'react-i18next';
import { ArrowRightIcon } from './icons';
import { useCheckoutStore } from '../stores/checkout-store';

/** Final conversion band on the pharmacy green. */
export function CtaBand() {
  const { t } = useTranslation();
  const openCheckout = useCheckoutStore((state) => state.openCheckout);

  return (
    <section aria-labelledby="cta-title" className="bg-papel pb-20 lg:pb-28">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="rounded-2xl bg-verde-cruz px-6 py-14 text-center sm:px-10 lg:py-16">
          <h2 id="cta-title" className="display text-3xl font-bold text-white sm:text-4xl">
            {t('cta_band.title')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl leading-relaxed text-white/80">
            {t('cta_band.body')}
          </p>
          <button
            type="button"
            className="btn btn-invert mt-8"
            onClick={() => openCheckout('PROVIDER')}
          >
            {t('cta_band.button')}
            <ArrowRightIcon className="text-base" />
          </button>
        </div>
      </div>
    </section>
  );
}
