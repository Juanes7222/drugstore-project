import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { BillingPeriod } from "@pharmacy/shared-types";
import { calculatePeriodPriceCents } from "../lib/format";
import { AnimatedPrice } from "./animated-price";
import { ArrowRightIcon, LogoMark } from "./icons";
import { Tear } from "./tear";
import { useCheckoutStore } from "../stores/checkout-store";
import { usePlansStore } from "../stores/plans-store";

const PERIOD_LABEL_KEY: Record<BillingPeriod, string> = {
  MONTHLY: "pricing.period_monthly",
  QUARTERLY: "pricing.period_quarterly",
  ANNUAL: "pricing.period_annual",
};

const TOTAL_SUFFIX_KEY: Record<BillingPeriod, string> = {
  MONTHLY: "pricing.total_suffix_monthly",
  QUARTERLY: "pricing.total_suffix_quarterly",
  ANNUAL: "pricing.total_suffix_annual",
};

/**
 * A customer's own words, if there are any yet. The whole page proves the
 * product; nothing on it says a single other shop runs it, which is the gap a
 * buyer feels at the moment of paying. Rendering nothing until a real quote
 * with a real attribution exists is the only honest version of this block — an
 * invented name on a live marketing site costs more trust than it buys.
 */
function TestimonialQuote() {
  const { t } = useTranslation();
  const quote = t("cta_band.testimonial.quote");
  const name = t("cta_band.testimonial.name");
  const role = t("cta_band.testimonial.role");

  if (!quote || !name) return null;

  return (
    <figure className="mt-10 max-w-md border-t border-papel-alto/25 pt-6">
      <blockquote className="display text-lg leading-snug">
        «{quote}»
      </blockquote>
      <figcaption className="data mt-4 text-xs text-papel-alto/75">
        {name}
        {role ? ` · ${role}` : ""}
      </figcaption>
    </figure>
  );
}

/**
 * The tear-off stub. The signature carried to the last moment before the
 * purchase, and the only place the button lives inside a document. Its total
 * always mirrors the period chosen in the pricing section.
 */
export function CtaBand() {
  const { t } = useTranslation();
  const openCheckout = useCheckoutStore((state) => state.openCheckout);
  const billingPeriod = useCheckoutStore((state) => state.billingPeriod);
  const livePlans = usePlansStore((state) => state.plans);

  // Both plans share the same price; the stub quotes whichever plan is first in
  // the effective catalog (seed or server).
  const totalCents = calculatePeriodPriceCents(
    livePlans[0].basePriceCents,
    billingPeriod,
  );

  return (
    <section aria-labelledby="cta-title" className="bg-verde text-papel-alto">
      <Tear bite="var(--color-papel)" />
      <div className="mx-auto max-w-[78rem] px-5 pt-16 pb-20 sm:px-8 lg:pt-20 lg:pb-24">
        <div className="grid items-start gap-14 lg:grid-cols-[1fr_21rem] lg:gap-20">
          <div>
            <h2
              id="cta-title"
              className="display max-w-md text-[clamp(2.2rem,4.6vw,3.4rem)]"
            >
              {t("cta_band.title")}
            </h2>
            <p className="data mt-7 max-w-sm text-sm text-papel-alto/75">
              {t("hero.reassure")}
            </p>
            <TestimonialQuote />
          </div>

          <div className="print-face">
            {/* Torn top edge, cut from the green field behind. */}
            <div
              className="notch"
              style={{ "--notch-color": "var(--color-verde)" } as CSSProperties}
              aria-hidden="true"
            />

            <div className="border-x border-line bg-papel-alto px-6 pt-5 pb-6 text-tinta">
              <div className="flex items-baseline justify-between gap-3">
                <p className="flex items-center gap-2 font-semibold">
                  <LogoMark className="text-base text-verde" />
                  <span className="display text-base">{t("brand.name")}</span>
                </p>
                <span className="data text-xs text-grafito">PF·LIC</span>
              </div>
              <p className="mt-1 border-b border-dashed border-line-strong pb-3 text-xs text-grafito">
                {t("cta_band.doc_title")}
              </p>

              <dl className="data flex items-baseline justify-between gap-4 pt-4 text-sm">
                <dt className="text-grafito">{t("pricing.period_label")}</dt>
                <dd className="shrink-0">
                  {t(PERIOD_LABEL_KEY[billingPeriod])}
                </dd>
              </dl>

              <div className="mt-3 flex items-baseline justify-between border-t border-dashed border-line-strong pt-4">
                <span className="display text-lg">
                  {t("cta_band.total_row")}
                </span>
                <span className="data text-2xl font-semibold">
                  <AnimatedPrice amountCents={totalCents} />{" "}
                  <span className="text-sm font-normal text-grafito">
                    {t(TOTAL_SUFFIX_KEY[billingPeriod])}
                  </span>
                </span>
              </div>

              <button
                type="button"
                className="btn btn-primary mt-5 w-full"
                onClick={() => openCheckout("PROVIDER", billingPeriod)}
              >
                {t("cta_band.button")}
                <ArrowRightIcon className="btn-arrow text-base" />
              </button>
            </div>

            {/* Torn bottom edge. */}
            <div
              className="notch"
              style={{ "--notch-color": "var(--color-verde)" } as CSSProperties}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
