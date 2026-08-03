// Request-scoped RLS transaction: the entire HTTP handler runs inside a
// single transaction that sets app.current_tenant once, so every read and
// write of the request observes the tenant. Nested $transaction calls then
// become inner savepoints (Prisma 7.5+), which keeps existing service code
// unchanged. afterCommit callbacks are drained after the outermost commit.
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@pharmacy/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';

const REQUEST_TRANSACTION_TIMEOUT_MS = 60_000;
const REQUEST_TRANSACTION_MAX_WAIT_MS = 10_000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly tenantContext: TenantContextService) {
    const connectionString = process.env.DATABASE_URL;
    const adapter = new PrismaPg({ connectionString });
    super({ adapter });
  }

  onModuleInit(): Promise<void> {
    return this.$connect();
  }

  onModuleDestroy(): Promise<void> {
    return this.$disconnect();
  }

  /**
   * Runs the given work in a single RLS-scoped transaction. app.current_tenant
   * is set via set_config(..., true) for transaction-local scope, so the pooled
   * connection returns clean regardless of how the transaction ends. After the
   * transaction commits, any afterCommit callbacks registered by the work are
   * drained best-effort; a failing callback must not roll back committed data.
   */
  async runWithTenant<T>(
    subscriptionId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<T> {
    const result = await this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${subscriptionId}, true)`;
        return fn(tx);
      },
      {
        timeout: options?.timeoutMs ?? REQUEST_TRANSACTION_TIMEOUT_MS,
        maxWait: options?.maxWaitMs ?? REQUEST_TRANSACTION_MAX_WAIT_MS,
      },
    );
    await this.tenantContext.drainAfterCommit();
    return result;
  }

  /**
   * Runs a flow inside an RLS-scoped transaction bound to the tenant of the
   * current context (a request or an explicit runWithTenant wrapper). Kept as
   * the entry point for job processors and scheduled tasks that operate
   * outside an HTTP request.
   */
  /**
   * Runs work inside an RLS-scoped request transaction while ALSO binding the
   * tenant into async-local storage, so tenantTransaction, registerAfterCommit
   * and subscriptionId stamping all work inside the callback. This is the
   * entry point for request handlers and job processors alike.
   */
  withTenant<T>(
    subscriptionId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<T> {
    return this.tenantContext.runWithTenant(subscriptionId, () =>
      this.runWithTenant(subscriptionId, fn, options),
    );
  }

  /**
   * Runs a flow inside an RLS-scoped transaction bound to the tenant of the
   * current context (a request or an explicit withTenant wrapper). Kept as
   * the entry point for nested flows that re-use the already-open savepoints.
   */
  tenantTransaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const subscriptionId = this.tenantContext.getSubscriptionId();
    return this.runWithTenant(subscriptionId, fn);
  }
}