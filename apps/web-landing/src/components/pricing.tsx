import { useTranslation } from "react-i18next";
import { BillingPeriod } from "@pharmacy/shared-types";
import { PlanDocument } from "./plan-document";
import { useCountUp } from "../hooks/use-count-up";
import { Tear } from "./tear";
import {
  calculatePeriodPriceCents,
  formatCOP,
  periodMonths,
} from "../lib/format";
import { useCheckoutStore } from "../stores/checkout-store";
import { usePlansStore } from "../stores/plans-store";

const PERIOD_OPTIONS: BillingPeriod[] = [
  BillingPeriod.MONTHLY,
  BillingPeriod.QUARTERLY,
  BillingPeriod.ANNUAL,
];

const PERIOD_LABEL_KEY: Record<BillingPeriod, string> = {
  MONTHLY: "pricing.period_monthly",
  QUARTERLY: "pricing.period_quarterly",
  ANNUAL: "pricing.period_annual",
};

/**
 * The conditions and the inclusions, as two mono strips. Everything the
 * documents do not show — because it is identical across both plans — lives
 * here instead of in a paragraph under them.
 */
function Footnotes() {
  const { t } = useTranslation();
  const groups = [
    t("pricing.terms_items", { returnObjects: true }) as string[],
    t("pricing.included_items", { returnObjects: true }) as string[],
  ];

  return (
    <div className="mx-auto mt-12 max-w-3xl space-y-2">
      {groups.map((items, index) => (
        <ul
          key={index}
          className="data flex flex-wrap justify-center gap-x-2 text-xs text-grafito"
        >
          {items.map((item, itemIndex) => (
            <li key={item} className="flex items-center gap-2">
              {itemIndex > 0 && (
                <span aria-hidden="true" className="text-tinta/30">
                  ·
                </span>
              )}
              {item}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/**
 * Pricing band: the monthly price as the total line of a receipt at
 * architectural size, the period selector beside it, then the two twin plan
 * documents that differ in exactly one field.
 */
export function Pricing() {
  const { t } = useTranslation();
  const billingPeriod = useCheckoutStore((state) => state.billingPeriod);
  const setBillingPeriod = useCheckoutStore((state) => state.setBillingPeriod);
  const plans = usePlansStore((state) => state.plans);
  const plansSource = usePlansStore((state) => state.source);
  const checkedAt = usePlansStore((state) => state.checkedAt);

  const basePriceCents = plans[0].basePriceCents;
  const totalCents = calculatePeriodPriceCents(basePriceCents, billingPeriod);
  // What the visitor actually pays per month, at the chosen period. This is the
  // plate's figure: a 5.4rem number that ignores the selector is not a price.
  const perMonthCents = Math.round(totalCents / periodMonths(billingPeriod));
  const hasDiscount = billingPeriod !== BillingPeriod.MONTHLY;
  // Counts up once on arrival, then rolls to each new period from wherever it
  // is. Mono figures, so neither move anything on the page.
  const [priceRef] = useCountUp<HTMLParagraphElement>(perMonthCents, 1100);

  // Provenance of the numbers below — quiet mono line, never an alarm.
  const checkedTimeLabel = checkedAt
    ? new Intl.DateTimeFormat("es-CO", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(checkedAt)
    : null;

  return (
    <section
      id="planes"
      aria-labelledby="pricing-title"
      className="scroll-mt-20 bg-papel"
    >
      <Tear bite="var(--color-tinta)" />

      <div className="mx-auto max-w-[78rem] px-5 pt-12 pb-20 sm:px-8 lg:pt-16 lg:pb-28">
        <p className="folio text-verde">{t("pricing.eyebrow")}</p>
        <h2
          id="pricing-title"
          className="display mt-5 max-w-2xl text-[clamp(1.8rem,3.4vw,2.5rem)]"
        >
          {t("pricing.title")}
        </h2>

        {/* Price plate + period selector.
            The plate states what you pay per month at the chosen period, and a
            period with a discount strikes the list price above it. A huge
            number that does not move when you pick a cheaper period is the one
            thing a pricing section cannot do: the label beside it is 14px and
            the eye lands on the plate. */}
        <div className="mt-12 grid gap-10 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-end lg:gap-16">
          <div>
            <p className="folio text-grafito">{t("pricing.price_label")}</p>
            {/* Height is reserved whether or not there is a discount, so
                toggling the period never shifts the plate. */}
            <p className="mt-4 flex h-7 items-center text-xl text-grafito">
              {hasDiscount && (
                <s className="price-was">{formatCOP(basePriceCents)}</s>
              )}
            </p>
            <p
              ref={priceRef}
              className="price-plate text-[clamp(3rem,7vw,5.4rem)] text-verde-hondo"
            >
              {formatCOP(perMonthCents)}
            </p>
            <p className="data mt-3 text-sm text-grafito">
              {t("pricing.total_suffix_monthly")}
            </p>
          </div>

          <div>
            {/* Native radios keep the arrow-key behaviour of a radio group. */}
            <fieldset>
              <legend className="folio text-grafito">
                {t("pricing.period_label")}
              </legend>
              <div className="mt-3 inline-flex flex-wrap border border-line-strong">
                {PERIOD_OPTIONS.map((period, index) => (
                  <label
                    key={period}
                    className={`relative ${index < PERIOD_OPTIONS.length - 1 ? "border-r border-line-strong" : ""}`}
                  >
                    <input
                      type="radio"
                      name="billing-period"
                      value={period}
                      checked={billingPeriod === period}
                      onChange={() => setBillingPeriod(period)}
                      className="peer sr-only"
                    />
                    <span className="data block cursor-pointer px-5 py-3 text-sm font-medium text-grafito peer-checked:bg-verde peer-checked:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:-outline-offset-2 peer-focus-visible:outline-verde">
                      {t(PERIOD_LABEL_KEY[period])}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* No "≈ per month" line here: the plate beside it already states
                the effective monthly figure, and a second copy of the same
                number is the one thing this section must not do. */}
            <p
              role="status"
              className="data mt-6 flex items-center gap-2 text-xs text-grafito"
            >
              <span
                aria-hidden="true"
                className={`pulse-dot inline-block size-1.5 rounded-full ${
                  plansSource === "server"
                    ? "bg-verde text-verde"
                    : "bg-tinta/30"
                }`}
              />
              {plansSource === "server"
                ? t("pricing.source_live", { time: checkedTimeLabel ?? "" })
                : t("pricing.source_fallback")}
            </p>
          </div>
        </div>

        {/* The twin documents */}
        <div className="mt-14 grid gap-x-10 gap-y-12 md:grid-cols-2">
          {plans.map((plan) => (
            <PlanDocument key={plan.code} plan={plan} period={billingPeriod} />
          ))}
        </div>

        <Footnotes />
      </div>
    </section>
  );
}
