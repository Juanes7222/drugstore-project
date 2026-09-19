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
//
// $transaction is the one member whose meaning depends on the RECEIVER:
// Prisma reads `this` to decide where the new transaction runs. Read off the
// tx object but called with this proxy as receiver, it opens a fresh
// transaction on another pooled connection instead of a savepoint on the
// request transaction — a connection with no app.current_tenant, where every
// RLS policy filters every row, so a service-level `$transaction` inside a
// request silently reads empty tables. Nested levels additionally have to be
// issued from the INNERMOST transaction client: Prisma rejects a nested call
// made from an outer one ("Concurrent nested transactions are not supported"),
// and this proxy's tenant context only tracks the outermost. Both are handled
// below by binding the call to the innermost client and by binding the
// transaction Prisma hands back for the duration of its callback.
import type { Prisma } from '@pharmacy/database';

export type TenantTx = Prisma.TransactionClient | null;

/**
 * Access to the transaction scope of the current request: the innermost active
 * transaction, and the ability to bind a nested one while its callback runs.
 */
export interface TenantTxScope {
  /** Innermost active transaction, or null outside a tenant transaction. */
  current(): TenantTx;
  /** Binds `tx` as the active transaction for the duration of `fn`. */
  runWith<T>(tx: Prisma.TransactionClient, fn: () => Promise<T>): Promise<T>;
}

type TransactionCallback = (tx: Prisma.TransactionClient) => Promise<unknown>;

type TransactionFn = (
  arg: TransactionCallback | unknown[],
  options?: unknown,
) => unknown;

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

/** Bound `$transaction` per transaction client, so repeated reads of the
 * property return the same function and callers can still hold a reference. */
const BOUND_TRANSACTION_BY_TX = new WeakMap<object, TransactionFn>();

function bindTransactionToTx(
  tx: object,
  root: object,
  scope: TenantTxScope,
  value: unknown,
): unknown {
  if (typeof value !== 'function') {
    return value;
  }
  const cached = BOUND_TRANSACTION_BY_TX.get(tx);
  if (cached) {
    return cached;
  }
  const bound: TransactionFn = (arg, options) => {
    // Resolved at call time: the property may have been read while an outer
    // transaction was active and called later, from inside a nested one.
    const active = scope.current();
    const client = active ?? root;
    const run = Reflect.get(client, '$transaction', client) as TransactionFn;
    if (typeof arg !== 'function' || !active) {
      // Batch form (`$transaction([...])`) has no callback to bind, and outside
      // a tenant transaction the root client is the only correct target.
      return run.call(client, arg, options);
    }
    // Nest into the innermost transaction and bind it while the callback runs,
    // so model calls inside the callback observe the same tenant.
    return run.call(
      active,
      (innerTx: Prisma.TransactionClient) =>
        scope.runWith(innerTx, () => (arg as TransactionCallback)(innerTx)),
      options,
    );
  };
  BOUND_TRANSACTION_BY_TX.set(tx, bound);
  return bound;
}

/**
 * Returns a proxy over `root` that delegates to the transaction returned by
 * `scope.current()` when one is active, and to `root` otherwise. The proxy
 * preserves `instanceof root.constructor` semantics and never changes the
 * public type.
 */
export function buildTenantAwareProxy<T extends object>(
  root: T,
  scope: TenantTxScope,
): T {
  return new Proxy(root, {
    get(target, prop, receiver) {
      // Symbols (Symbol.toPrimitive, Symbol.toStringTag, util.inspect.custom)
      // and client-only lifecycle/extension hooks always go to root.
      if (typeof prop === 'symbol' || ROOT_ONLY_PROPS.has(prop)) {
        return Reflect.get(target, prop, receiver);
      }
      const tx = scope.current();
      if (tx && prop in tx) {
        const value = Reflect.get(tx, prop, tx);
        return prop === '$transaction'
          ? bindTransactionToTx(tx, target, scope, value)
          : value;
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as T;
}
