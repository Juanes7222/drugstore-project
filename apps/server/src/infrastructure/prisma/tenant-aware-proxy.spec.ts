import { buildTenantAwareProxy, type TenantTxScope } from './tenant-aware-proxy';

/**
 * Transaction-shaped object matching the real Prisma TransactionClient
 * surface: model delegates are plain objects, $-methods are functions, and
 * the ITX deny-list members exist as undefined properties.
 */
function createFakeTx(): Record<string, unknown> {
  return {
    sale: { findMany: jest.fn(), create: jest.fn() },
    product: { findMany: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
    $connect: undefined,
    $disconnect: undefined,
    $on: undefined,
    $use: undefined,
    $extends: undefined,
  };
}

describe('buildTenantAwareProxy', () => {
  let root: Record<string, unknown>;
  let tx: Record<string, unknown>;
  let currentTx: Record<string, unknown> | null;
  let scope: TenantTxScope;

  beforeEach(() => {
    root = {
      sale: { findMany: jest.fn(), create: jest.fn() },
      product: { findMany: jest.fn() },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
      $executeRaw: jest.fn(),
      $connect: jest.fn(),
      $disconnect: jest.fn(),
      $on: jest.fn(),
      $use: jest.fn(),
      $extends: jest.fn(),
      then: undefined,
      [Symbol.toPrimitive]: () => 'PrismaClient',
      // Service-level members that must never resolve on the tx.
      withTenant: jest.fn(),
      tenantContext: { getTx: () => null },
    };
    tx = createFakeTx();
    currentTx = null;
    scope = {
      current: () => currentTx as never,
      // Mirrors TenantContextService.runWithTx: binds the nested tx while the
      // callback runs and restores the previous one afterwards.
      runWith: async (nestedTx, fn) => {
        const previous = currentTx;
        currentTx = nestedTx as unknown as Record<string, unknown>;
        try {
          return await fn();
        } finally {
          currentTx = previous;
        }
      },
    };
  });

  const build = (): Record<string, unknown> =>
    buildTenantAwareProxy(root, scope);

  it('routes model delegates to the root client when no tx is active', () => {
    const proxy = build();
    expect(proxy.sale).toBe(root.sale);
    expect(proxy.$transaction).toBe(root.$transaction);
  });

  it('routes model delegates to the active transaction when one exists', () => {
    currentTx = tx;
    const proxy = build();
    // Delegates are plain objects: a typeof-function check would miss them.
    expect(proxy.sale).toBe(tx.sale);
    expect(proxy.product).toBe(tx.product);
  });

  it('routes $queryRaw and $executeRaw to the tx when active', () => {
    currentTx = tx;
    const proxy = build();
    expect(proxy.$queryRaw).toBe(tx.$queryRaw);
    expect(proxy.$executeRaw).toBe(tx.$executeRaw);
  });

  /**
   * Prisma decides which client a new transaction belongs to by reading the
   * receiver of `$transaction`. Invoked with the proxy as receiver it opens a
   * fresh transaction on another pooled connection — no app.current_tenant, so
   * under RLS a service-level `$transaction` inside a request reads 0 rows.
   */
  it('invokes the tx $transaction with the tx itself as receiver', () => {
    const receivers: unknown[] = [];
    const txTransaction = jest.fn(function (this: unknown) {
      receivers.push(this);
      return Promise.resolve(undefined);
    });
    tx.$transaction = txTransaction;
    currentTx = tx;
    const proxy = build();

    void proxy.$transaction(jest.fn());

    expect(txTransaction).toHaveBeenCalledTimes(1);
    expect(receivers[0]).toBe(tx);
    void currentTx;
  });

  /**
   * Prisma rejects a nested transaction issued from anything but the innermost
   * client ("Concurrent nested transactions are not supported"), and the tenant
   * context only tracks the outermost one, so each nested level has to route
   * from — and bind — the transaction it created.
   */
  it('nests each new transaction from the innermost client and binds it', async () => {
    const requestTx = createFakeTx();
    const savepointTx = createFakeTx();
    const deepSavepointTx = createFakeTx();
    const seen: unknown[] = [];
    const receivers: unknown[] = [];

    (requestTx.$transaction as jest.Mock).mockImplementation(
      (callback: (nested: unknown) => Promise<unknown>) => {
        receivers.push(requestTx);
        return callback(savepointTx);
      },
    );
    (savepointTx.$transaction as jest.Mock).mockImplementation(
      (callback: (nested: unknown) => Promise<unknown>) => {
        receivers.push(savepointTx);
        return callback(deepSavepointTx);
      },
    );

    currentTx = requestTx;
    const proxy = build();
    const runTransaction = proxy.$transaction as (
      fn: () => Promise<void>,
    ) => Promise<void>;

    await runTransaction(async () => {
      seen.push(currentTx);
      await runTransaction(async () => {
        seen.push(currentTx);
      });
      seen.push(currentTx);
    });

    // Each level ran on — and bound — the transaction it belongs to.
    expect(receivers).toEqual([requestTx, savepointTx]);
    expect(seen).toEqual([savepointTx, deepSavepointTx, savepointTx]);
    expect(currentTx).toBe(requestTx);
  });

  it('returns a stable bound $transaction across accesses', () => {
    currentTx = tx;
    const proxy = build();
    expect(proxy.$transaction).toBe(proxy.$transaction);
  });

  it('keeps client-only lifecycle props on the root even with an active tx', () => {
    currentTx = tx;
    const proxy = build();
    expect(proxy.$connect).toBe(root.$connect);
    expect(proxy.$disconnect).toBe(root.$disconnect);
    expect(proxy.$on).toBe(root.$on);
    expect(proxy.$use).toBe(root.$use);
    expect(proxy.$extends).toBe(root.$extends);
  });

  it('keeps service-level members on the root even with an active tx', () => {
    currentTx = tx;
    const proxy = build();
    expect(proxy.withTenant).toBe(root.withTenant);
    expect(proxy.tenantContext).toBe(root.tenantContext);
  });

  it('keeps `then` and symbols on the root (never thenable, no hijacked coercion)', () => {
    currentTx = tx;
    const proxy = build();
    expect(proxy.then).toBeUndefined();
    expect(proxy[Symbol.toPrimitive]).toBe(root[Symbol.toPrimitive]);
  });

  it('preserves instanceof semantics', () => {
    class Fake {}
    const fake = new Fake();
    const proxy = buildTenantAwareProxy(
      fake as unknown as Record<string, unknown>,
      scope,
    );
    expect(proxy instanceof Fake).toBe(true);
  });
});
