import { Prisma } from '@pharmacy/database';

/**
 * Deterministic positive int4 hash of a string, suitable for PostgreSQL
 * advisory lock keys (`pg_advisory_xact_lock(bigint)`).
 *
 * @param value the value to hash — scope the key by tenant + entity kind so
 *        locks serialize only the intended work (e.g. `${subscriptionId}:PO`).
 */
export function hashAdvisoryKey(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return hash & 0x7fffffff;
}

/**
 * Acquire a PostgreSQL advisory transaction lock inside an existing
 * transaction. The lock is released automatically when the transaction
 * commits or rolls back.
 *
 * Use this to serialize check-then-act sections (idempotency guards,
 * sequential-number allocation) that would otherwise race under concurrent
 * requests or duplicate BullMQ deliveries.
 */
export async function acquireAdvisoryLock(
  tx: Prisma.TransactionClient,
  scope: string,
): Promise<void> {
  const lockKey = hashAdvisoryKey(scope);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey}::bigint)`;
}
