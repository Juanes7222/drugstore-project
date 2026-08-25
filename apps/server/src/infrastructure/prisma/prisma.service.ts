// Request-scoped RLS transaction: the entire HTTP handler runs inside a
// single transaction that sets app.current_tenant once, so every read and
// write of the request observes the tenant. Nested $transaction calls then
// become inner savepoints (Prisma 7.8 + adapter-pg), which keeps existing
// service code unchanged. afterCommit callbacks are drained after the
// outermost commit.
//
// The constructor returns a tenant-aware proxy over the instance: services
// keep calling `this.prisma.<model>` on the injected client, and while a
// request transaction is active the proxy routes those calls into the
// transaction (which carries the SET LOCAL tenant context). NestJS 11
// instantiates class providers via `new`, so the returned proxy becomes the
// injected instance and the lifecycle hooks still resolve on the real
// instance through the proxy fallback.
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@pharmacy/database';
import { PrismaPg } from '@prisma/adapter-pg';
import { TenantContextService } from '@/modules/tenant/tenant-context.service';
import { buildTenantAwareProxy } from './tenant-aware-proxy';

const REQUEST_TRANSACTION_TIMEOUT_MS = 60_000;
const REQUEST_TRANSACTION_MAX_WAIT_MS = 10_000;
// Every HTTP handler runs inside a request-scoped RLS transaction, so each
// in-flight request holds one pooled connection for its full duration. The pg
// default (max 10 per process) exhausts quickly under concurrent traffic;
// size the pool explicitly and let deployments tune it via DB_POOL_MAX.
const DEFAULT_DB_POOL_MAX = 20;

// Positive finite number, floored — '2.5' → 2, invalid input falls back to the default.
function resolveDbPoolMax(): number {
  const raw = Number(process.env.DB_POOL_MAX);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_DB_POOL_MAX;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(private readonly tenantContext: TenantContextService) {
    const connectionString = process.env.DATABASE_URL;
    const adapter = new PrismaPg({ connectionString, max: resolveDbPoolMax() });
    super({ adapter });
    // Return the tenant-aware proxy as the DI instance: `this.prisma.x`
    // inside a request resolves to the active transaction, outside to the
    // root pool client. `instanceof PrismaService` keeps working because
    // the proxy targets this instance.
    return buildTenantAwareProxy(this, () => this.tenantContext.getTx());
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
   * connection returns clean regardless of how the transaction ends. The
   * transaction is bound to the tenant context while the work runs, so the
   * tenant-aware proxy routes every `this.prisma.<model>` call into it. After
   * the transaction commits, any afterCommit callbacks registered by the work
   * are drained best-effort; a failing callback must not roll back committed
   * data.
   */
  async runWithTenant<T>(
    subscriptionId: string,
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { timeoutMs?: number; maxWaitMs?: number },
  ): Promise<T> {
    const result = await this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant', ${subscriptionId}, true)`;
        this.tenantContext.setTx(tx);
        try {
          return await fn(tx);
        } finally {
          this.tenantContext.clearTx();
        }
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
   * Runs work inside an RLS-scoped request transaction while ALSO binding the
   * tenant into async-local storage, so tenantTransaction, registerAfterCommit
   * and subscriptionId stamping all work inside the callback. This is the
   * entry point for request handlers (TenantContextInterceptor) and job
   * processors / scheduled tasks that operate outside an HTTP request.
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
  tenantTransaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const subscriptionId = this.tenantContext.getSubscriptionId();
    return this.runWithTenant(subscriptionId, fn);
  }
}
