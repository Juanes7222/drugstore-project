// Bridges the root Prisma client to the active request transaction.
//
// TenantContextInterceptor runs every authenticated request inside a single
// RLS-scoped transaction (PrismaService.withTenant) that sets
// app.current_tenant via set_config(..., true) once. Services keep calling
// `this.prisma.<model>` on the injected client; this proxy routes those
// calls to the active transaction so every query observes the
// transaction-local tenant. Outside any transaction it falls back to the
// root pool client.
//
// Routing rule: when a transaction is active, delegate the whole Prisma
// client API surface (model delegates, $transaction, $queryRaw,
// $executeRaw, ...) to it. Model delegates are plain objects, so this must
// be a membership check (`prop in tx`), not a typeof-function check — a
// function check silently falls back to the root client, which has no
// tenant context and would fail RLS (0 rows) or leak cross-tenant data.
import type { Prisma, PrismaClient } from '@pharmacy/database';

export type TenantTx = Prisma.TransactionClient | null;

/**
 * Client-level surface that must always resolve on the root client, never on
 * the transaction client. The interactive-transaction client exposes these
 * as undefined (Prisma's ITXClientDenyList), so `prop in tx` is true for
 * them and routing to the tx would return undefined. `then` is excluded so
 * the proxy is never treated as a thenable by `await` or Promise machinery.
 */
const ROOT_ONLY_PROPS = new Set<PropertyKey>([
  '$connect',
  '$disconnect',
  '$on',
  '$use',
  '$extends',
  'then',
]);

/**
 * Returns a proxy over `root` that delegates to the transaction returned by
 * `getTx` when one is active, and to `root` otherwise. The proxy preserves
 * `instanceof root.constructor` semantics and never changes the public type.
 */
export function buildTenantAwareProxy<T extends object>(
  root: T,
  getTx: () => TenantTx,
): T {
  return new Proxy(root, {
    get(target, prop, receiver) {
      // Symbols (Symbol.toPrimitive, Symbol.toStringTag, util.inspect.custom)
      // and client-only lifecycle/extension hooks always go to root.
      if (typeof prop === 'symbol' || ROOT_ONLY_PROPS.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      const tx = getTx();
      if (tx && prop in tx) {
        // Transaction active: delegate to it, bound to the tx so nested
        // $transaction calls become inner savepoints on the same connection.
        //
        // Note: getTx() returns the single outer transaction, so inside a
        // nested $transaction callback `this.prisma.<model>` still resolves
        // to the OUTER tx. That is intentional: savepoints are positional on
        // the shared connection, so those queries still roll back correctly;
        // do not "fix" this by tracking an innermost-tx stack without
        // re-verifying savepoint semantics end to end.
        return Reflect.get(tx, prop, tx);
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}
