/**
 * Shared e2e seed helper: creates the Plan + Subscription rows required by
 * the multi-tenant schema, then stamps tenant-scoped seed rows with the
 * subscription id. Specs written before multi-tenancy landed only need to
 * call `seedSubscription()` in their beforeAll and spread the returned id
 * into every tenant-scoped create (Product, Lot, TaxScheme, PaymentMethod,
 * Client, CashShift, Sale, ...).
 */
type PrismaLike = {
  plan: {
    upsert(args: Record<string, unknown>): Promise<unknown>;
  };
  subscription: {
    upsert(args: Record<string, unknown>): Promise<unknown>;
  };
};

/**
 * Idempotent plan/subscription seed. `suffix` keeps ids unique per spec so
 * suites never fight over the same rows when run against a shared database.
 */
export async function seedSubscription(
  prisma: PrismaLike,
  suffix: string,
): Promise<string> {
  const planId = `e2e-plan-${suffix}`;
  const subscriptionId = `e2e-sub-${suffix}`;

  await prisma.plan.upsert({
    where: { id: planId },
    update: {},
    create: {
      id: planId,
      code: `e2e-plan-code-${suffix}`,
      name: `E2E Plan ${suffix}`,
      pricingModel: 'FLAT',
      basePriceCents: 0,
    },
  });

  await prisma.subscription.upsert({
    where: { id: subscriptionId },
    update: {},
    create: {
      id: subscriptionId,
      planId,
      customerName: `E2E Customer ${suffix}`,
      customerTaxId: `900${suffix.replace(/[^0-9]/g, '').padEnd(6, '0')}1`,
      status: 'ACTIVE',
      currentPeriodStart: new Date('2026-01-01'),
      currentPeriodEnd: new Date('2027-01-01'),
    },
  });

  return subscriptionId;
}

/** Convenience: build the tenant-stamp for a create payload. */
export function withSubscription(
  subscriptionId: string,
  data: Record<string, unknown>,
): Record<string, unknown> {
  return { ...data, subscriptionId };
}
