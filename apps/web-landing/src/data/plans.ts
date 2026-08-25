import { DEFAULT_PLANS } from '@pharmacy/shared-types';

export interface PlanView {
  code: string;
  name: string;
  description: string | null;
  billingMethod: 'PROVIDER' | 'CERTIFICATE';
  basePriceCents: number;
  includedWorkstations: number;
  extraWorkstationPriceCents: number | null;
}

/**
 * The build-time fallback catalog, straight from the same seed the server
 * loads into its Plan table. Rendered immediately on first paint so the page
 * never waits on the network; the plans store replaces it in place once
 * `GET /public/plans` answers with validated live data.
 *
 * Exactly two seed plans are expected; anything else means the seed changed
 * and this site needs a review before shipping prices.
 */
export const SEED_PLANS: PlanView[] = DEFAULT_PLANS.filter(
  (plan) => plan.isPublic && plan.isActive,
).map((plan) => ({
  code: plan.code,
  name: plan.name,
  description: plan.description,
  billingMethod: plan.billingMethod,
  basePriceCents: plan.basePriceCents,
  includedWorkstations: plan.includedWorkstations,
  extraWorkstationPriceCents: plan.extraWorkstationPriceCents,
}));

if (SEED_PLANS.length !== 2) {
  throw new Error(
    `Expected exactly 2 public plans in DEFAULT_PLANS, found ${SEED_PLANS.length}`,
  );
}
