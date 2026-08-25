import { z } from 'zod';
import type { PlanView } from '../data/plans';

/**
 * Shape the landing needs from `GET /public/plans`. Validated with Zod
 * because a marketing page must never render a malformed price: anything
 * that does not parse exactly falls back to the seed catalog.
 */
const PublicPlanSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  billingMethod: z.enum(['PROVIDER', 'CERTIFICATE']),
  basePriceCents: z.number().int().nonnegative(),
  includedWorkstations: z.number().int().nonnegative(),
  extraWorkstationPriceCents: z.number().int().nonnegative().nullable(),
  displayOrder: z.number().int().nonnegative(),
});

const PublicPlansResponseSchema = z.array(PublicPlanSchema);

/**
 * Fetch the live public catalog. Sorts by displayOrder (the server's order)
 * and maps to the view model. Throws on network failure, non-JSON or schema
 * mismatch — callers treat every throw as "keep showing the seed prices".
 */
export async function fetchPublicPlans(apiBaseUrl: string): Promise<PlanView[]> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/public/plans`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });

  if (!response.ok) {
    throw new Error(`GET /public/plans responded ${response.status}`);
  }

  const payload: unknown = await response.json();
  const plans = PublicPlansResponseSchema.parse(payload);

  return plans.map((plan) => ({
    code: plan.code,
    name: plan.name,
    description: plan.description ?? null,
    billingMethod: plan.billingMethod,
    basePriceCents: plan.basePriceCents,
    includedWorkstations: plan.includedWorkstations,
    extraWorkstationPriceCents: plan.extraWorkstationPriceCents,
  }));
}
