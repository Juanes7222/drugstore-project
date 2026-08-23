/**
 * PlanCatalog — subscription plan list with billing-period selector.
 *
 * Renders the public Wompi checkout plans with period pricing (quarterly
 * 10% off, annual 20% off, computed by estimatePeriodAmountCents), capacity
 * and feature lines, and the CTA that starts the checkout flow.
 *
 * @category Component
 */
import { type FC, useState } from "react";
import { useTranslation } from "react-i18next";
import { BillingPeriod } from "@pharmacy/shared-types";
import {
  estimatePeriodAmountCents,
  type CheckoutPlan,
} from "../../../domain/licensing/wompi-checkout.service";
import { AlertTriangleIcon, Building2Icon, CheckCircleIcon, CloudIcon, CreditCardIcon, HelpCircleIcon, MonitorIcon, ShieldIcon } from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import { useAssistantStore } from "../../../stores/assistant.store";
import { FEATURE_LABELS } from "./license-status.helpers";

/** Help topic id for the DIAN digital certificate explainer. */
const DIAN_CERTIFICATE_HELP_TOPIC = "fiscal-dian-certificate";

export interface PlanCatalogProps {
  plans: CheckoutPlan[];
  isLoading: boolean;
  /** "PLANS_LOAD_FAILED" when the catalog fetch failed; null otherwise. */
  errorCode: string | null;
  onSelectPlan: (plan: CheckoutPlan, period: BillingPeriod) => void;
}

// COP has no minor units in practice; whole-peso formatting keeps price
// columns short and unambiguous at a glance.
const COP_FORMATTER = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

const PERIODS: BillingPeriod[] = [
  BillingPeriod.MONTHLY,
  BillingPeriod.QUARTERLY,
  BillingPeriod.ANNUAL,
];

const PERIOD_LABEL_KEY: Record<BillingPeriod, string> = {
  [BillingPeriod.MONTHLY]: "licensing.plans.period.monthly",
  [BillingPeriod.QUARTERLY]: "licensing.plans.period.quarterly",
  [BillingPeriod.ANNUAL]: "licensing.plans.period.annual",
};

const PERIOD_DISCOUNT_KEY: Partial<Record<BillingPeriod, string>> = {
  [BillingPeriod.QUARTERLY]: "licensing.plans.discount.quarterly",
  [BillingPeriod.ANNUAL]: "licensing.plans.discount.annual",
};

const PERIOD_UNIT_KEY: Record<BillingPeriod, string> = {
  [BillingPeriod.MONTHLY]: "licensing.plans.card.per_month",
  [BillingPeriod.QUARTERLY]: "licensing.plans.card.per_quarter",
  [BillingPeriod.ANNUAL]: "licensing.plans.card.per_year",
};

interface PeriodSelectorProps {
  period: BillingPeriod;
  onChange: (period: BillingPeriod) => void;
}

const PeriodSelector: FC<PeriodSelectorProps> = ({ period, onChange }) => {
  const { t } = useTranslation();

  return (
    <div
      role="radiogroup"
      aria-label={t("licensing.plans.period.selector_aria")}
      className="inline-flex rounded-pos border border-border bg-panel p-pos-xs shadow-pos-panel"
    >
      {PERIODS.map((option) => {
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

interface PlanCardProps {
  plan: CheckoutPlan;
  period: BillingPeriod;
  onSelect: (plan: CheckoutPlan, period: BillingPeriod) => void;
}

const PlanCard: FC<PlanCardProps> = ({ plan, period, onSelect }) => {
  const { t } = useTranslation();
  const openHelp = useAssistantStore((s) => s.openHelp);
  const amountCents = estimatePeriodAmountCents(plan.basePriceCents, period);
  const discountKey = PERIOD_DISCOUNT_KEY[period];
  const isCertificatePlan = plan.billingMethod === "CERTIFICATE";

  return (
    <article className="flex flex-col rounded-pos border border-border bg-panel p-pos-lg shadow-pos-panel">
      <h3 className="text-ui font-semibold text-ink">{plan.name}</h3>
      <p className="mt-pos-xs mb-pos-md text-body-sm text-ink-muted">{plan.description}</p>

      {/* Billing method — how DIAN transmission happens. Hidden for legacy
          plans whose billingMethod is null. */}
      {plan.billingMethod && (
        <div className="mb-pos-md">
          <div className="flex flex-wrap items-center gap-pos-sm">
            <span
              className={`inline-flex items-center gap-pos-xs rounded-pos px-pos-sm py-0.5 text-caption font-semibold ${
                isCertificatePlan
                  ? "bg-restrict/10 text-restrict"
                  : "bg-pharma/10 text-pharma"
              }`}
            >
              {isCertificatePlan ? (
                <ShieldIcon className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <CloudIcon className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {t(`licensing.plans.card.billing_method.${plan.billingMethod}`)}
            </span>
            {isCertificatePlan && (
              <button
                type="button"
                className="inline-flex items-center gap-pos-xs text-caption font-medium underline underline-offset-2 transition-colors hover:text-pharma"
                style={{ color: "var(--color-restrict)" }}
                aria-label={t("licensing.plans.card.billing_help_aria")}
                onClick={() => openHelp(DIAN_CERTIFICATE_HELP_TOPIC)}
              >
                <HelpCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                {t("licensing.plans.card.billing_help")}
              </button>
            )}
          </div>
          <p className="mt-pos-xs text-caption text-ink-muted">
            {t(`licensing.plans.card.billing_note.${plan.billingMethod}`)}
          </p>
        </div>
      )}

      {/* Price line — mono, tabular, with period unit so a quarterly total
          can never be read as a monthly rate. */}
      <div className="mb-pos-md flex items-baseline gap-pos-sm">
        <span className="font-data text-price font-semibold tabular-nums text-ink">
          {COP_FORMATTER.format(amountCents)}
        </span>
        <span className="text-body-sm text-ink-muted">{t(PERIOD_UNIT_KEY[period])}</span>
        {discountKey && (
          <span className="rounded-pos bg-pharma/10 px-pos-sm py-0.5 font-data text-caption font-semibold text-pharma">
            {t(discountKey)}
          </span>
        )}
      </div>

      {/* Capacity */}
      <div className="mb-pos-md space-y-pos-xs">
        <div className="flex items-center gap-pos-sm text-body-sm text-ink-muted">
          <Building2Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            {t("licensing.plans.card.capacity", { count: plan.maxLocations })}
          </span>
        </div>
        <div className="flex items-center gap-pos-sm text-body-sm text-ink-muted">
          <MonitorIcon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <span>
            {t("licensing.plans.card.workstations", { count: plan.includedWorkstations })}
          </span>
        </div>
        {plan.extraWorkstationPriceCents !== null && (
          <p className="text-caption text-ink-muted">
            {t("licensing.plans.card.extra_workstation", {
              price: COP_FORMATTER.format(plan.extraWorkstationPriceCents),
            })}
          </p>
        )}
      </div>

      {/* Features */}
      {plan.features.length > 0 && (
        <ul className="mb-pos-lg space-y-pos-xs">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-center gap-pos-sm text-body-sm text-ink">
              <CheckCircleIcon className="h-4 w-4 flex-shrink-0 text-pharma" aria-hidden="true" />
              {t(FEATURE_LABELS[feature] ?? feature)}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        className="pos-button pos-button-primary mt-auto w-full py-pos-md text-ui font-bold"
        onClick={() => onSelect(plan, period)}
      >
        {t("licensing.plans.card.choose")}
      </button>
    </article>
  );
};

export const PlanCatalog: FC<PlanCatalogProps> = ({
  plans,
  isLoading,
  errorCode,
  onSelectPlan,
}) => {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<BillingPeriod>(BillingPeriod.MONTHLY);
  const sortedPlans = [...plans].sort((a, b) => a.displayOrder - b.displayOrder);

  return (
    <section
      aria-label={t("licensing.plans.title")}
      className="flex h-full flex-col overflow-y-auto bg-surface p-pos-lg"
    >
      <div className="mb-pos-sm flex items-center gap-pos-md">
        <CreditCardIcon className="h-6 w-6 text-pharma" aria-hidden="true" />
        <h1 className="text-heading font-semibold text-ink">{t("licensing.plans.title")}</h1>
      </div>
      <p className="mb-pos-lg text-body text-ink-muted">{t("licensing.plans.subtitle")}</p>

      {isLoading && (
        <div
          className="flex flex-1 items-center justify-center gap-pos-sm text-body text-ink-muted"
          role="status"
          aria-busy="true"
        >
          <LoaderIcon className="h-5 w-5 animate-spin text-sync" aria-hidden="true" />
          {t("licensing.plans.catalog.loading")}
        </div>
      )}

      {!isLoading && errorCode && (
        <div
          className="flex items-start gap-pos-sm rounded-pos border border-error/30 bg-error-container px-pos-md py-pos-sm text-body-sm text-error"
          role="alert"
        >
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-semibold">
              {t(`licensing.plans.errors.${errorCode}`)}
            </p>
            <p className="mt-pos-xs text-error/90">
              {t("licensing.plans.catalog.error_hint")}
            </p>
          </div>
        </div>
      )}

      {!isLoading && !errorCode && sortedPlans.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="text-body text-ink-muted">{t("licensing.plans.catalog.empty")}</p>
        </div>
      )}

      {!isLoading && !errorCode && sortedPlans.length > 0 && (
        <>
          <div className="mb-pos-lg flex justify-center">
            <PeriodSelector period={period} onChange={setPeriod} />
          </div>
          <div className="grid grid-cols-1 gap-pos-md md:grid-cols-2 xl:grid-cols-3">
            {sortedPlans.map((plan) => (
              <PlanCard key={plan.code} plan={plan} period={period} onSelect={onSelectPlan} />
            ))}
          </div>
        </>
      )}
    </section>
  );
};