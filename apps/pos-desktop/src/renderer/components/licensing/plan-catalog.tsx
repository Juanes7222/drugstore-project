/**
 * PlanCatalog — compact plan catalog for terminals without an active license.
 *
 * The onboarding gate view: two plans, one billing-period selector, minimal
 * prose. Each card answers three questions only — how DIAN billing works,
 * what it costs, what is included. Feature lists render as a dense chip grid
 * instead of stacked rows so the price line stays the tallest element.
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
import { formatCurrency } from "@/utils/format-currency";
import {
  AlertTriangleIcon,
  Building2Icon,
  CheckIcon,
  CloudIcon,
  CreditCardIcon,
  HelpCircleIcon,
  MonitorIcon,
  ShieldIcon,
} from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import { useAssistantStore } from "../../../stores/assistant.store";
import { FEATURE_LABELS } from "./license-status.helpers";
import { isUnlimitedLocations } from "./plan-comparison.helpers";
import {
  BillingPeriodSelector,
  PERIOD_DISCOUNT_KEY,
  PERIOD_UNIT_KEY,
} from "./billing-period-selector";

/** Help topic id for the DIAN digital certificate explainer. */
const DIAN_CERTIFICATE_HELP_TOPIC = "fiscal-dian-certificate";

export interface PlanCatalogProps {
  plans: CheckoutPlan[];
  isLoading: boolean;
  /** "PLANS_LOAD_FAILED" when the catalog fetch failed; null otherwise. */
  errorCode: string | null;
  onSelectPlan: (plan: CheckoutPlan, period: BillingPeriod) => void;
}

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
  const unlimitedLocations = isUnlimitedLocations(plan.maxLocations, plan.features);

  return (
    <article className="flex flex-col rounded-pos border border-border border-t-4 bg-panel p-pos-lg shadow-pos-panel [border-top-color:var(--color-pharma)]">
      {/* Billing method — the one real structural difference between plans */}
      <div className="mb-pos-sm flex flex-wrap items-center gap-pos-sm">
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
          {t(`licensing.plans.card.billing_method.${plan.billingMethod ?? "PROVIDER"}`)}
        </span>
        {isCertificatePlan && (
          <button
            type="button"
            className="inline-flex items-center gap-pos-xs text-caption font-medium text-restrict underline underline-offset-2 transition-colors hover:text-pharma"
            aria-label={t("licensing.plans.card.billing_help_aria")}
            onClick={() => openHelp(DIAN_CERTIFICATE_HELP_TOPIC)}
          >
            <HelpCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {t("licensing.plans.card.billing_help")}
          </button>
        )}
      </div>

      <h3 className="text-ui font-semibold text-ink">{plan.name}</h3>
      <p className="mt-pos-xs text-caption text-ink-muted">{plan.description}</p>

      {/* Price line — mono, tabular; the unit makes a quarterly total impossible
          to misread as a monthly rate. */}
      <div className="mt-pos-md mb-pos-md flex items-baseline gap-pos-sm">
        <span className="font-data text-price font-semibold tabular-nums text-ink">
          {formatCurrency(amountCents)}
        </span>
        <span className="text-body-sm text-ink-muted">{t(PERIOD_UNIT_KEY[period])}</span>
        {discountKey && (
          <span className="rounded-pos bg-pharma/10 px-pos-sm py-0.5 font-data text-caption font-semibold text-pharma">
            {t(discountKey)}
          </span>
        )}
      </div>

      {/* Capacity — the sentinel value never reaches the user as "999" */}
      <div className="mb-pos-md space-y-pos-xs text-body-sm text-ink-muted">
        <p className="flex items-center gap-pos-sm">
          <Building2Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {unlimitedLocations
            ? t("licensing.subscription.unlimited_locations")
            : t("licensing.plans.card.capacity", { count: plan.maxLocations })}
        </p>
        <p className="flex items-center gap-pos-sm">
          <MonitorIcon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
          {t("licensing.plans.card.workstations", { count: plan.includedWorkstations })}
          {plan.extraWorkstationPriceCents !== null && (
            <span className="text-caption">
              ·{" "}
              {t("licensing.plans.card.extra_workstation", {
                price: formatCurrency(plan.extraWorkstationPriceCents),
              })}
            </span>
          )}
        </p>
      </div>

      {/* Included features as a dense chip grid */}
      {plan.features.length > 0 && (
        <ul className="mb-pos-lg flex flex-wrap gap-pos-xs" aria-label={t("licensing.status_page.features_title")}>
          {plan.features.map((feature) => (
            <li
              key={feature}
              className="inline-flex items-center gap-1 rounded-pos bg-surface-variant px-pos-sm py-0.5 text-caption text-ink"
            >
              <CheckIcon className="h-3 w-3 flex-shrink-0 text-pharma" aria-hidden="true" />
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
            <BillingPeriodSelector period={period} onChange={setPeriod} />
          </div>
          <div className="mx-auto grid w-full max-w-4xl grid-cols-1 gap-pos-md md:grid-cols-2">
            {sortedPlans.map((plan) => (
              <PlanCard key={plan.code} plan={plan} period={period} onSelect={onSelectPlan} />
            ))}
          </div>
        </>
      )}
    </section>
  );
};
