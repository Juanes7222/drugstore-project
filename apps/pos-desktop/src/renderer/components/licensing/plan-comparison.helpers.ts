/**
 * Pure comparison logic for the merged subscription screen.
 *
 * Computes the feature/price/billing-method delta between the terminal's
 * current plan (from the license store) and each catalog candidate, so the
 * UI can render a "lo que ganas / lo que consideras" ledger instead of
 * repeating the full feature checklist of every plan.
 *
 * @category Utilities
 */

/** Server sentinel for "no location cap" — never shown to the user raw. */
export const UNLIMITED_LOCATIONS_SENTINEL = 999;

export const UNLIMITED_LOCATIONS_FEATURE = "UNLIMITED_LOCATIONS";

export function isUnlimitedLocations(
  maxLocations: number | null,
  features: readonly string[],
): boolean {
  return (
    features.includes(UNLIMITED_LOCATIONS_FEATURE) ||
    maxLocations === null ||
    maxLocations >= UNLIMITED_LOCATIONS_SENTINEL
  );
}

export interface PlanFeatureDelta {
  /** Features the candidate adds relative to the current plan. */
  gained: string[];
  /** Features the current plan has that the candidate drops. */
  lost: string[];
}

export function computeFeatureDelta(
  currentFeatures: readonly string[],
  candidateFeatures: readonly string[],
): PlanFeatureDelta {
  const current = new Set(currentFeatures);
  const candidate = new Set(candidateFeatures);

  return {
    gained: candidateFeatures.filter((feature) => !current.has(feature)),
    lost: currentFeatures.filter((feature) => !candidate.has(feature)),
  };
}

/** Monthly base-price difference in cents (candidate − current). */
export function monthlyPriceDeltaCents(
  currentBasePriceCents: number,
  candidateBasePriceCents: number,
): number {
  return candidateBasePriceCents - currentBasePriceCents;
}

export type BillingMethodCode = "PROVIDER" | "CERTIFICATE";

export function normalizeBillingMethod(method: string | null | undefined): BillingMethodCode {
  return method === "CERTIFICATE" ? "CERTIFICATE" : "PROVIDER";
}

export interface BillingTradeoff {
  /**
   * i18n key of the headline advantage the candidate has over the incumbent,
   * or null when both plans bill the same way.
   */
  gainsKey: string | null;
  /** i18n key of the trade-off to consider before switching, or null. */
  considersKey: string | null;
}

// Key roots live under licensing.subscription.delta.billing; composed here so
// every combination stays in one place instead of scattering ternaries in JSX.
const BILLING_TRADEOFF_KEYS: Record<
  BillingMethodCode,
  Record<BillingMethodCode, BillingTradeoff>
> = {
  PROVIDER: {
    PROVIDER: { gainsKey: null, considersKey: null },
    CERTIFICATE: {
      gainsKey: "licensing.subscription.delta.billing.from_provider_to_certificate_gain",
      considersKey: "licensing.subscription.delta.billing.from_provider_to_certificate_consider",
    },
  },
  CERTIFICATE: {
    PROVIDER: {
      gainsKey: "licensing.subscription.delta.billing.from_certificate_to_provider_gain",
      considersKey: "licensing.subscription.delta.billing.from_certificate_to_provider_consider",
    },
    CERTIFICATE: { gainsKey: null, considersKey: null },
  },
};

export function getBillingTradeoff(
  currentMethod: string | null | undefined,
  candidateMethod: string | null | undefined,
): BillingTradeoff {
  return BILLING_TRADEOFF_KEYS[normalizeBillingMethod(currentMethod)][
    normalizeBillingMethod(candidateMethod)
  ];
}
