import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { PosPreview } from './pos-preview';
import { ArrowRightIcon, CheckIcon } from './icons';
import { useCheckoutStore } from '../stores/checkout-store';

const TRUST_CHIPS = ['hero.chip_dian', 'hero.chip_invima', 'hero.chip_offline'] as const;

/** Hero — the offline-first thesis beside a faithful slice of the real POS. */
export function Hero() {
  const { t } = useTranslation();
  const openCheckout = useCheckoutStore((state) => state.openCheckout);

  return (
    <section id="inicio" className="overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-16 pb-20 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:pt-24 lg:pb-28">
        <div>
          <p className="eyebrow rise-in text-verde-cruz" style={{ '--rise-index': 0 } as CSSProperties}>
            {t('hero.eyebrow')}
          </p>
          <h1
            className="display rise-in mt-4 text-4xl leading-[1.06] font-bold sm:text-5xl lg:text-[3.4rem]"
            style={{ '--rise-index': 1 } as CSSProperties}
          >
            {t('hero.title')}
          </h1>
          <p
            className="rise-in mt-6 max-w-xl text-lg leading-relaxed text-tinta-media"
            style={{ '--rise-index': 2 } as CSSProperties}
          >
            {t('hero.subtitle')}
          </p>

          <div
            className="rise-in mt-8 flex flex-wrap gap-3"
            style={{ '--rise-index': 3 } as CSSProperties}
          >
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => openCheckout('PROVIDER')}
            >
              {t('hero.cta_primary')}
              <ArrowRightIcon className="btn-arrow text-base" />
            </button>
            <a href="#planes" className="btn btn-secondary">
              {t('hero.cta_secondary')}
            </a>
          </div>

          <ul
            className="rise-in mt-10 flex flex-wrap gap-x-6 gap-y-3"
            style={{ '--rise-index': 4 } as CSSProperties}
          >
            {TRUST_CHIPS.map((chip) => (
              <li key={chip} className="flex items-center gap-2 text-sm font-medium">
                <CheckIcon className="text-base text-verde-cruz" />
                {t(chip)}
              </li>
            ))}
          </ul>
        </div>

        <div className="rise-in min-w-0" style={{ '--rise-index': 2 } as CSSProperties}>
          <PosPreview />
        </div>
      </div>
    </section>
  );
}
