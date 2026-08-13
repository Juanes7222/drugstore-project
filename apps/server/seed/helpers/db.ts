import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@pharmacy/database';
import {
  buildTenantAwareProxy,
  type TenantTx,
} from '../../src/infrastructure/prisma/tenant-aware-proxy';

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL environment variable is not set.');
    console.error('Make sure a .env file exists in apps/server/ with DATABASE_URL defined.');
    process.exit(1);
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

// The seed modules import `prisma` and call `prisma.<model>` directly, so the
// exported client is a tenant-aware proxy — the same one PrismaService uses to
// route every request into an RLS-scoped transaction. While withSeedTenant()
// has an open transaction, every call is routed into it (all writes then pass
// the FORCE row-level security policies); outside it (e.g. $disconnect) the
// proxy falls back to the root client.
const rootPrisma = createPrismaClient();

let activeTx: TenantTx = null;

export const prisma: PrismaClient = buildTenantAwareProxy(rootPrisma, () => activeTx);

/** Hard limit for the whole seed transaction — the seed is a batch script. */
const SEED_TRANSACTION_TIMEOUT_MS = 600_000;
/** How long to wait for a pooled connection before giving up. */
const SEED_TRANSACTION_MAX_WAIT_MS = 60_000;

/**
 * Runs the seed work inside a single RLS-scoped transaction.
 *
 * app.current_tenant is set transaction-locally (`set_config(..., true)`),
 * the same pattern the app uses in PrismaService.runWithTenant, so every
 * `prisma.<model>` call made by the seed modules observes the tenant and
 * passes the row-level security policies. A failing seed rolls the whole
 * batch back atomically.
 */
export async function withSeedTenant<T>(
  subscriptionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return rootPrisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant', ${subscriptionId}, true)`;
      activeTx = tx;
      try {
        return await fn();
      } finally {
        activeTx = null;
      }
    },
    {
      timeout: SEED_TRANSACTION_TIMEOUT_MS,
      maxWait: SEED_TRANSACTION_MAX_WAIT_MS,
    },
  );
}
