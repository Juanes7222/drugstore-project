/**
 * Shared cross-tenant aggregation for saas-admin services. Sale (and other
 * tenant tables) enforce FORCE ROW LEVEL SECURITY, so any platform-side read
 * of tenant rows must run once per subscription inside an RLS-scoped
 * transaction; a single unscoped query fails closed to zero rows.
 */

import { PrismaService } from '@/infrastructure/prisma/prisma.service';
import type { Prisma } from '@pharmacy/database';

type TenantTx = Prisma.TransactionClient;

/** How many tenants are aggregated concurrently inside RLS-scoped transactions. */
export const TENANT_AGGREGATION_CONCURRENCY = 10;

/**
 * Run a per-tenant read inside an RLS-scoped transaction for each
 * subscription id, bounded concurrency, results in input order.
 */
export async function aggregateAcrossTenants<T>(
  prisma: Pick<PrismaService, 'withTenant'>,
  subscriptionIds: string[],
  fn: (tx: TenantTx, subscriptionId: string) => Promise<T>,
): Promise<T[]> {
  const results = new Array<T>(subscriptionIds.length);
  for (
    let start = 0;
    start < subscriptionIds.length;
    start += TENANT_AGGREGATION_CONCURRENCY
  ) {
    const batch = subscriptionIds.slice(
      start,
      start + TENANT_AGGREGATION_CONCURRENCY,
    );
    const settled = await Promise.all(
      batch.map((subscriptionId) =>
        prisma.withTenant(subscriptionId, (tx) => fn(tx, subscriptionId)),
      ),
    );
    for (let i = 0; i < batch.length; i += 1) {
      results[start + i] = settled[i];
    }
  }
  return results;
}
