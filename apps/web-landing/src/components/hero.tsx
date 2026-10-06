import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { PosPreview } from "./pos-preview";
import { ArrowRightIcon } from "./icons";
import { useCheckoutStore } from "../stores/checkout-store";

const TRUST_STAMPS = [
  "hero.stamp_dian",
  "hero.stamp_invima",
  "hero.stamp_offline",
] as const;

/**
 * Hero — the thesis, stated once, beside a faithful slice of the real POS.
 *
 * The sheet it sits on opens with the printed header a receipt has: which folio
 * this is out of six on the left, the document's own id on the right, and the
 * rule between. That states the reader's position in the document instead of
 * floating a label above the headline, and it is the one place the eyebrow
 * voice appears — everything below it drops the label and lets the heading carry
 * itself.
 */
export function Hero() {
  const { t } = useTranslation();
  const openCheckout = useCheckoutStore((state) => state.openCheckout);
  const folios = t("rail.items", { returnObjects: true }) as {
    folio: string;
  }[];

  return (
    <section id="inicio" className="relative overflow-hidden">
      <div className="hero-ambient" aria-hidden="true" />

      <div className="relative mx-auto max-w-[78rem] px-5 sm:px-8">
        <div className="rise-in flex items-baseline justify-between gap-4 border-b border-line pb-2 pt-14 lg:pt-20">
          <p className="folio text-verde">
            {folios[0].folio} / {folios.length} · {t("hero.eyebrow")}
          </p>
          <p className="folio text-grafito">{t("brand.doc_id")}</p>
        </div>

        <div className="grid items-center gap-12 pb-16 lg:grid-cols-[1.06fr_0.94fr] lg:gap-14 lg:pb-24">
          <div className="pt-12 lg:pt-20">
            <h1
              className="display rise-in text-[clamp(2.4rem,5.2vw,4.1rem)]"
              style={{ "--rise-index": 0 } as CSSProperties}
            >
              {t("hero.title")}
            </h1>

            <p
              className="rise-in mt-7 max-w-md text-lg leading-relaxed text-grafito"
              style={{ "--rise-index": 1 } as CSSProperties}
            >
              {t("hero.subtitle")}
            </p>

            <div
              className="rise-in mt-9 flex flex-wrap items-center gap-x-7 gap-y-4"
              style={{ "--rise-index": 2 } as CSSProperties}
            >
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => openCheckout("PROVIDER")}
              >
                {t("hero.cta_primary")}
                <ArrowRightIcon className="btn-arrow text-base" />
              </button>
              <a href="#planes" className="link-rule text-sm font-medium">
                {t("hero.cta_secondary")}
              </a>
            </div>

            <ul
              className="rise-in mt-10 flex flex-wrap gap-2"
              style={{ "--rise-index": 3 } as CSSProperties}
            >
              {TRUST_STAMPS.map((stamp) => (
                <li
                  key={stamp}
                  className="folio border border-line-strong px-2.5 py-1.5 text-tinta"
                >
                  {t(stamp)}
                </li>
              ))}
            </ul>

            <p
              className="data rise-in mt-6 text-xs text-grafito"
              style={{ "--rise-index": 4 } as CSSProperties}
            >
              {t("hero.reassure")}
            </p>
          </div>

          <div
            className="rise-in min-w-0"
            style={{ "--rise-index": 1 } as CSSProperties}
          >
            <PosPreview />
          </div>
        </div>
      </div>
    </section>
  );
}
