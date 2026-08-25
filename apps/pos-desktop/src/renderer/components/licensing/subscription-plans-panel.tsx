/**
 * SubscriptionPlansPanel — the "cambiar de plan" section of the merged
 * subscription screen.
 *
 * Shows the terminal's current plan once (compact, non-purchasable) and every
 * other catalog plan as a delta card: only what CHANGES relative to the
 * current plan (feature diff + billing-method trade-off + monthly price
 * difference). When the catalog cannot be reached the section degrades to a
 * calm offline note — comparing plans requires the server, and the user's
 * current benefits keep working regardless.
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
  CheckIcon,
  CloudIcon,
  CreditCardIcon,
  InfoIcon,
  MinusIcon,
  ShieldIcon,
} from "@/components/ui/icons";
import { LoaderIcon } from "@/components/ui/icons/animated";
import { FEATURE_LABELS } from "./license-status.helpers";
import {
  computeFeatureDelta,
  getBillingTradeoff,
  monthlyPriceDeltaCents,
} from "./plan-comparison.helpers";
import {
  BillingPeriodSelector,
  PERIOD_UNIT_KEY,
} from "./billing-period-selector";

export interface SubscriptionPlansPanelProps {
  plans: CheckoutPlan[];
  /** Plan code stored in the local license; null when unknown. */
  currentPlanCode: string | null;
  currentFeatures: readonly string[];
  currentBillingMethod: string | null;
  /**
   * Monthly base price of the CURRENT plan in cents, matched from the
   * catalog by plan code; null when the current plan is not in the catalog
   * (legacy code) — deltas are hidden instead of guessed.
   */
  currentBasePriceCents: number | null;
  isLoading: boolean;
  /** "PLANS_LOAD_FAILED" when the fetch failed; null otherwise. */
  errorCode: string | null;
  onSelectPlan: (plan: CheckoutPlan, period: BillingPeriod) => void;
}

interface DeltaListProps {
  /** Feature codes plus optional headline trade-off keys. */
  entries: Array<{ key: string; isFeature: boolean }>;
  tone: "gain" | "consider";
}

const DeltaList: FC<DeltaListProps> = ({ entries, tone }) => {
  const { t } = useTranslation();
  if (entries.length === 0) return null;

  return (
    <ul className="space-y-pos-xs">
      {entries.map(({ key, isFeature }) => (
        <li
          key={key}
          className={`flex items-start gap-pos-sm text-body-sm ${
            tone === "gain" ? "text-ink" : "text-ink-muted"
          }`}
        >
          {tone === "gain" ? (
            <CheckIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-pharma" aria-hidden="true" />
          ) : (
            <MinusIcon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-urgency" aria-hidden="true" />
          )}
          <span>
            {isFeature ? t(FEATURE_LABELS[key] ?? key) : t(key)}
          </span>
        </li>
      ))}
    </ul>
  );
};

interface CandidateCardProps {
  plan: CheckoutPlan;
  period: BillingPeriod;
  currentFeatures: readonly string[];
  currentBillingMethod: string | null;
  currentBasePriceCents: number | null;
  onSelect: (plan: CheckoutPlan, period: BillingPeriod) => void;
}

const CandidateCard: FC<CandidateCardProps> = ({
  plan,
  period,
  currentFeatures,
  currentBillingMethod,
  currentBasePriceCents,
  onSelect,
}) => {
  const { t } = useTranslation();
  const amountCents = estimatePeriodAmountCents(plan.basePriceCents, period);
  const featureDelta = computeFeatureDelta(currentFeatures, plan.features);
  const tradeoff = getBillingTradeoff(currentBillingMethod, plan.billingMethod);

  // Price delta compares monthly bases so it stays true under any selector period.
  const priceDelta =
    currentBasePriceCents !== null
      ? monthlyPriceDeltaCents(currentBasePriceCents, plan.basePriceCents)
      : null;

  const gainEntries = [
    ...(tradeoff.gainsKey ? [{ key: tradeoff.gainsKey, isFeature: false }] : []),
    ...featureDelta.gained.map((feature) => ({ key: feature, isFeature: true })),
  ];
  const considerEntries = [
    ...(tradeoff.considersKey ? [{ key: tradeoff.considersKey, isFeature: false }] : []),
    ...featureDelta.lost.map((feature) => ({ key: feature, isFeature: true })),
  ];

  const isCertificatePlan = plan.billingMethod === "CERTIFICATE";

  return (
    <article className="flex flex-col rounded-pos border border-border bg-panel p-pos-lg shadow-pos-panel">
      <div className="mb-pos-xs flex items-center gap-pos-sm">
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
      </div>
      <h3 className="text-ui font-semibold text-ink">{plan.name}</h3>

      <div className="mt-pos-md mb-pos-md">
        <div className="flex items-baseline gap-pos-sm">
          <span className="font-data text-price font-semibold tabular-nums text-ink">
            {formatCurrency(amountCents)}
          </span>
          <span className="text-body-sm text-ink-muted">{t(PERIOD_UNIT_KEY[period])}</span>
        </div>
        {priceDelta !== null && (
          <p
            className={`mt-pos-xs font-data text-caption font-medium tabular-nums ${
              priceDelta > 0 ? "text-urgency" : priceDelta < 0 ? "text-pharma" : "text-ink-muted"
            }`}
          >
            {priceDelta > 0 &&
              t("licensing.subscription.delta.price_more", {
                price: formatCurrency(Math.abs(priceDelta)),
              })}
            {priceDelta < 0 &&
              t("licensing.subscription.delta.price_less", {
                price: formatCurrency(Math.abs(priceDelta)),
              })}
            {priceDelta === 0 && t("licensing.subscription.delta.price_same")}
          </p>
        )}
      </div>

      {(gainEntries.length > 0 || considerEntries.length > 0) && (
        <div className="mb-pos-md space-y-pos-sm">
          {gainEntries.length > 0 && (
            <div>
              <h4 className="mb-pos-xs text-caption font-semibold uppercase tracking-wide text-pharma">
                {t("licensing.subscription.delta.gains_title")}
              </h4>
              <DeltaList entries={gainEntries} tone="gain" />
            </div>
          )}
          {considerEntries.length > 0 && (
            <div>
              <h4 className="mb-pos-xs text-caption font-semibold uppercase tracking-wide text-urgency">
                {t("licensing.subscription.delta.considers_title")}
              </h4>
              <DeltaList entries={considerEntries} tone="consider" />
            </div>
          )}
        </div>
      )}

      <button
        type="button"
        className="pos-button pos-button-secondary mt-auto w-full py-pos-md text-ui font-bold hover:border-pharma hover:text-pharma"
        onClick={() => onSelect(plan, period)}
      >
        <CreditCardIcon className="h-4 w-4" aria-hidden="true" />
        {t("licensing.subscription.change_to_plan")}
      </button>
    </article>
  );
};

interface CurrentPlanCardProps {
  plan: CheckoutPlan;
}

const CurrentPlanCard: FC<CurrentPlanCardProps> = ({ plan }) => {
  const { t } = useTranslation();

  return (
    <article
      aria-label={t("licensing.subscription.current_card_aria")}
      className="flex flex-col rounded-pos border border-pharma/40 bg-pharma/5 p-pos-lg"
    >
      <span className="mb-pos-xs inline-flex w-fit items-center rounded-pos bg-pharma px-pos-sm py-0.5 text-caption font-bold uppercase tracking-wide text-panel">
        {t("licensing.subscription.current_badge")}
      </span>
      <h3 className="text-ui font-semibold text-ink">{plan.name}</h3>
      <div className="mt-pos-md flex items-baseline gap-pos-sm">
        <span className="font-data text-price font-semibold tabular-nums text-ink">
          {formatCurrency(plan.basePriceCents)}
        </span>
        <span className="text-body-sm text-ink-muted">{t(PERIOD_UNIT_KEY[BillingPeriod.MONTHLY])}</span>
      </div>
      <p className="mt-auto pt-pos-md text-caption text-ink-muted">
        {t("licensing.subscription.current_hint")}
      </p>
    </article>
  );
};

export const SubscriptionPlansPanel: FC<SubscriptionPlansPanelProps> = ({
  plans,
  currentPlanCode,
  currentFeatures,
  currentBillingMethod,
  currentBasePriceCents,
  isLoading,
  errorCode,
  onSelectPlan,
}) => {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<BillingPeriod>(BillingPeriod.MONTHLY);

  const sortedPlans = [...plans].sort((a, b) => a.displayOrder - b.displayOrder);
  const currentPlan =
    sortedPlans.find((plan) => plan.code === currentPlanCode) ?? null;
  // The incumbent never renders as a purchasable candidate, matched or not.
  const candidates = currentPlan
    ? sortedPlans.filter((plan) => plan.code !== currentPlan.code)
    : sortedPlans;
  // Deltas are only honest when we truly know the incumbent (matched in the
  // catalog AND with a known price); otherwise the ledger is hidden instead
  // of guessed and candidates fall back to plain cards.
  const canCompare = currentPlan !== null && currentBasePriceCents !== null;

  return (
    <section aria-label={t("licensing.subscription.change_title")}>
      <div className="mb-pos-md flex flex-wrap items-center justify-between gap-pos-md">
        <h2 className="text-ui font-semibold uppercase tracking-wide text-ink-muted">
          {t("licensing.subscription.change_title")}
        </h2>
        <BillingPeriodSelector period={period} onChange={setPeriod} />
      </div>

      {isLoading && (
        <div
          className="flex items-center justify-center gap-pos-sm rounded-pos border border-border bg-panel py-pos-xl text-body text-ink-muted"
          role="status"
          aria-busy="true"
        >
          <LoaderIcon className="h-5 w-5 animate-spin text-sync" aria-hidden="true" />
          {t("licensing.plans.catalog.loading")}
        </div>
      )}

      {!isLoading && errorCode && (
        <div
          className="flex items-start gap-pos-sm rounded-pos border border-sync/30 bg-sync/5 px-pos-md py-pos-md text-body-sm text-sync"
          role="status"
        >
          <InfoIcon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">{t("licensing.subscription.offline_title")}</p>
            <p className="mt-pos-xs text-sync/90">{t("licensing.subscription.offline_body")}</p>
          </div>
        </div>
      )}

      {!isLoading && !errorCode && (
        <div className="grid grid-cols-1 gap-pos-md lg:grid-cols-2 xl:grid-cols-3">
          {!canCompare && currentPlan !== null && <CurrentPlanCard plan={currentPlan} />}
          {candidates.map((plan) =>
            canCompare ? (
              <CandidateCard
                key={plan.code}
                plan={plan}
                period={period}
                currentFeatures={currentFeatures}
                currentBillingMethod={currentBillingMethod}
                currentBasePriceCents={currentBasePriceCents}
                onSelect={onSelectPlan}
              />
            ) : (
              // Legacy/unmatched current plan: fall back to plain catalog-style
              // pricing without a fabricated ledger.
              <PlainCandidateCard
                key={plan.code}
                plan={plan}
                period={period}
                onSelect={onSelectPlan}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
};

interface PlainCandidateCardProps {
  plan: CheckoutPlan;
  period: BillingPeriod;
  onSelect: (plan: CheckoutPlan, period: BillingPeriod) => void;
}

// Catalog-style fallback card when no incumbent comparison is possible.
const PlainCandidateCard: FC<PlainCandidateCardProps> = ({ plan, period, onSelect }) => {
  const { t } = useTranslation();
  const amountCents = estimatePeriodAmountCents(plan.basePriceCents, period);

  return (
    <article className="flex flex-col rounded-pos border border-border bg-panel p-pos-lg shadow-pos-panel">
      <h3 className="text-ui font-semibold text-ink">{plan.name}</h3>
      <div className="mt-pos-md mb-pos-lg flex items-baseline gap-pos-sm">
        <span className="font-data text-price font-semibold tabular-nums text-ink">
          {formatCurrency(amountCents)}
        </span>
        <span className="text-body-sm text-ink-muted">{t(PERIOD_UNIT_KEY[period])}</span>
      </div>
      <button
        type="button"
        className="pos-button pos-button-secondary mt-auto w-full py-pos-md text-ui font-bold hover:border-pharma hover:text-pharma"
        onClick={() => onSelect(plan, period)}
      >
        {t("licensing.subscription.change_to_plan")}
      </button>
    </article>
  );
};
