import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { BillingPeriod } from "@pharmacy/shared-types";
import type { PlanView } from "../data/plans";
import {
  calculatePeriodPriceCents,
  formatCOP,
  periodMonths,
} from "../lib/format";
import { useAnimatedAmount } from "../hooks/use-animated-amount";
import { AnimatedPrice } from "./animated-price";
import { ArrowRightIcon } from "./icons";
import { useCheckoutStore } from "../stores/checkout-store";

interface PlanDocumentProps {
  plan: PlanView;
  period: BillingPeriod;
}

const SUFFIX_KEY: Record<BillingPeriod, string> = {
  MONTHLY: "pricing.total_suffix_monthly",
  QUARTERLY: "pricing.total_suffix_quarterly",
  ANNUAL: "pricing.total_suffix_annual",
};

const ROW_KEYS = [
  "pricing.row_workstations",
  "pricing.row_extra_workstation",
  "pricing.row_locations",
  "pricing.row_support",
] as const;

/**
 * One plan as a printed document — the site's signature. Both documents are
 * deliberately identical except for the DIAN block, which sits at the very top
 * because it is the only field that actually differs.
 *
 * Changing the billing period does not just roll the number: the document is
 * stamped as reissued, because what the reader just did was choose a different
 * document, not edit a number in place.
 */
export function PlanDocument({ plan, period }: PlanDocumentProps) {
  const { t } = useTranslation();
  const openCheckout = useCheckoutStore((state) => state.openCheckout);

  const isProvider = plan.billingMethod === "PROVIDER";
  const totalCents = calculatePeriodPriceCents(plan.basePriceCents, period);
  const perMonthCents = Math.round(totalCents / periodMonths(period));
  // Hook at the top level (Rules of Hooks): the "≈ al mes" line rolls too, even
  // though it only renders for non-monthly periods.
  const animatedPerMonthCents = useAnimatedAmount(perMonthCents, 420);

  // Counts reissues, so the stamp can re-trigger its own entrance each time
  // rather than only on first paint.
  const [reissues, setReissues] = useState(0);
  const previousPeriod = useRef(period);
  useEffect(() => {
    if (previousPeriod.current === period) return;
    previousPeriod.current = period;
    setReissues((count) => count + 1);
  }, [period]);

  return (
    // No `sheet` here: the children below paint the sheet's own edges, because
    // the torn bottom edge has to cut through the border that a wrapper would
    // otherwise draw underneath it. The article is the group, not a container.
    <article className="print-face flex flex-col">
      {/* Document header */}
      <div className="flex items-baseline justify-between gap-3 border-x border-t border-line bg-papel-alto px-6 py-4 sm:px-7">
        <p className="folio text-verde">{t("pricing.doc_heading")}</p>
        {reissues > 0 ? (
          <span
            key={reissues}
            className="reprint-stamp folio shrink-0 border border-verde px-2 py-0.5 text-verde-hondo"
          >
            {t("pricing.doc_reissued")}
          </span>
        ) : (
          <span className="data shrink-0 text-xs text-grafito">
            PF·{plan.code}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col border-x border-line bg-papel-alto px-6 pt-6 pb-7 sm:px-7">
        <p className="text-xs text-grafito">{t("pricing.doc_disclaimer")}</p>

        {/* The one honest difference between the plans, stated first. */}
        <div className="mt-4 border border-line bg-menta px-4 py-3">
          <p className="folio text-verde-hondo">
            {t("pricing.dian_section_title")}
          </p>
          <p className="display mt-2 text-xl">
            {isProvider
              ? t("pricing.dian_provider_title")
              : t("pricing.dian_certificate_title")}
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-verde-hondo/80">
            {isProvider
              ? t("pricing.dian_provider_body")
              : t("pricing.dian_certificate_body")}
          </p>
        </div>

        <p className="display mt-6 text-lg">{plan.name}</p>

        {/* Concept rows */}
        <dl className="mt-6 border-t border-line-quiet text-sm">
          {ROW_KEYS.map((key) => {
            const value =
              key === "pricing.row_workstations"
                ? t("pricing.value_workstations")
                : key === "pricing.row_extra_workstation"
                  ? plan.extraWorkstationPriceCents !== null
                    ? t("pricing.value_extra_workstation", {
                        amount: formatCOP(plan.extraWorkstationPriceCents),
                      })
                    : "—"
                  : key === "pricing.row_locations"
                    ? t("pricing.value_locations")
                    : t("pricing.value_support");
            return (
              <div
                key={key}
                className="flex items-baseline justify-between gap-4 border-b border-line-quiet py-2.5"
              >
                <dt className="text-grafito">{t(key)}</dt>
                <dd className="data shrink-0">{value}</dd>
              </div>
            );
          })}
        </dl>

        {/* Total — pinned to the bottom so both twins align across columns */}
        <div className="mt-auto pt-5">
          <div className="doc-rule" aria-hidden="true" />
          <div className="flex items-baseline justify-between pt-4">
            <span className="display text-lg">{t("pricing.total_row")}</span>
            <span className="data text-2xl font-semibold">
              <AnimatedPrice amountCents={totalCents} />{" "}
              <span className="text-sm font-normal text-grafito">
                {t(SUFFIX_KEY[period])}
              </span>
            </span>
          </div>
          {period !== "MONTHLY" && (
            <p className="data mt-1 text-right text-xs text-grafito">
              {t("pricing.per_month_equivalent", {
                amount: formatCOP(animatedPerMonthCents),
              })}
            </p>
          )}
        </div>

        <button
          type="button"
          className="btn btn-primary mt-6 w-full"
          onClick={() => openCheckout(plan.code, period)}
        >
          {t("pricing.doc_cta")}
          <ArrowRightIcon className="btn-arrow text-base" />
        </button>
      </div>

      {/* Torn bottom edge — the sheet ends the way a receipt ends. */}
      <div
        className="notch"
        style={{ "--notch-color": "var(--color-papel)" } as CSSProperties}
        aria-hidden="true"
      />
    </article>
  );
}
