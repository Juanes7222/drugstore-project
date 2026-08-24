import { DEFAULT_PLANS } from '@pharmacy/shared-types';

export interface PlanView {
  code: string;
  name: string;
  billingMethod: 'PROVIDER' | 'CERTIFICATE';
  basePriceCents: number;
  includedWorkstations: number;
  extraWorkstationPriceCents: number | null;
}

/**
 * The public catalog, straight from the same seed the server loads into its
 * Plan table. Exactly two plans are expected; anything else means the seed
 * changed and this site needs a review before shipping prices.
 */
export const PUBLIC_PLANS: PlanView[] = DEFAULT_PLANS.filter(
  (plan) => plan.isPublic && plan.isActive,
).map((plan) => ({
  code: plan.code,
  name: plan.name,
  billingMethod: plan.billingMethod,
  basePriceCents: plan.basePriceCents,
  includedWorkstations: plan.includedWorkstations,
  extraWorkstationPriceCents: plan.extraWorkstationPriceCents,
}));

if (PUBLIC_PLANS.length !== 2) {
  throw new Error(
    `Expected exactly 2 public plans in DEFAULT_PLANS, found ${PUBLIC_PLANS.length}`,
  );
}
