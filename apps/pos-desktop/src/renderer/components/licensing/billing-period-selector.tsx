/**
 * BillingPeriodSelector — monthly/quarterly/annual radio group with the
 * period discount badges. Shared by the plan catalog and the subscription
 * screen so both price views always agree on the selected period.
 *
 * @category Component
 */
import { type FC } from "react";
import { useTranslation } from "react-i18next";
import { BillingPeriod } from "@pharmacy/shared-types";

export const BILLING_PERIODS: BillingPeriod[] = [
  BillingPeriod.MONTHLY,
  BillingPeriod.QUARTERLY,
  BillingPeriod.ANNUAL,
];

export const PERIOD_DISCOUNT_KEY: Partial<Record<BillingPeriod, string>> = {
  [BillingPeriod.QUARTERLY]: "licensing.plans.discount.quarterly",
  [BillingPeriod.ANNUAL]: "licensing.plans.discount.annual",
};

export const PERIOD_UNIT_KEY: Record<BillingPeriod, string> = {
  [BillingPeriod.MONTHLY]: "licensing.plans.card.per_month",
  [BillingPeriod.QUARTERLY]: "licensing.plans.card.per_quarter",
  [BillingPeriod.ANNUAL]: "licensing.plans.card.per_year",
};

const PERIOD_LABEL_KEY: Record<BillingPeriod, string> = {
  [BillingPeriod.MONTHLY]: "licensing.plans.period.monthly",
  [BillingPeriod.QUARTERLY]: "licensing.plans.period.quarterly",
  [BillingPeriod.ANNUAL]: "licensing.plans.period.annual",
};

export interface BillingPeriodSelectorProps {
  period: BillingPeriod;
  onChange: (period: BillingPeriod) => void;
}

export const BillingPeriodSelector: FC<BillingPeriodSelectorProps> = ({
  period,
  onChange,
}) => {
  const { t } = useTranslation();

  return (
    <div
      role="radiogroup"
      aria-label={t("licensing.plans.period.selector_aria")}
      className="inline-flex rounded-pos border border-border bg-panel p-pos-xs shadow-pos-panel"
    >
      {BILLING_PERIODS.map((option) => {
        const isSelected = option === period;
        const discountKey = PERIOD_DISCOUNT_KEY[option];
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={isSelected}
            className={`inline-flex items-center gap-pos-xs rounded-pos px-pos-md py-pos-sm text-body-sm font-medium transition-colors ${
              isSelected
                ? "bg-pharma text-panel"
                : "text-ink-muted hover:bg-surface-variant hover:text-ink"
            }`}
            onClick={() => onChange(option)}
          >
            {t(PERIOD_LABEL_KEY[option])}
            {discountKey && (
              <span
                className={`rounded-pos px-pos-xs py-px font-data text-caption font-semibold ${
                  isSelected ? "bg-panel/20 text-panel" : "bg-pharma/10 text-pharma"
                }`}
              >
                {t(discountKey)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
