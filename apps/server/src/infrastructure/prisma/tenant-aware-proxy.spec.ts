import { buildTenantAwareProxy } from './tenant-aware-proxy';

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
  let getTx: jest.Mock;

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
    getTx = jest.fn(() => null);
  });

  it('routes model delegates to the root client when no tx is active', () => {
    const proxy = buildTenantAwareProxy(root, getTx);
    expect(proxy.sale).toBe(root.sale);
    expect(proxy.$transaction).toBe(root.$transaction);
  });

  it('routes model delegates to the active transaction when one exists', () => {
    getTx.mockReturnValue(tx);
    const proxy = buildTenantAwareProxy(root, getTx);
    // Delegates are plain objects: a typeof-function check would miss them.
    expect(proxy.sale).toBe(tx.sale);
    expect(proxy.product).toBe(tx.product);
  });

  it('routes $transaction, $queryRaw and $executeRaw to the tx when active', () => {
    getTx.mockReturnValue(tx);
    const proxy = buildTenantAwareProxy(root, getTx);
    expect(proxy.$transaction).toBe(tx.$transaction);
    expect(proxy.$queryRaw).toBe(tx.$queryRaw);
    expect(proxy.$executeRaw).toBe(tx.$executeRaw);
  });

  it('keeps client-only lifecycle props on the root even with an active tx', () => {
    getTx.mockReturnValue(tx);
    const proxy = buildTenantAwareProxy(root, getTx);
    expect(proxy.$connect).toBe(root.$connect);
    expect(proxy.$disconnect).toBe(root.$disconnect);
    expect(proxy.$on).toBe(root.$on);
    expect(proxy.$use).toBe(root.$use);
    expect(proxy.$extends).toBe(root.$extends);
  });

  it('keeps service-level members on the root even with an active tx', () => {
    getTx.mockReturnValue(tx);
    const proxy = buildTenantAwareProxy(root, getTx);
    expect(proxy.withTenant).toBe(root.withTenant);
    expect(proxy.tenantContext).toBe(root.tenantContext);
  });

  it('keeps `then` and symbols on the root (never thenable, no hijacked coercion)', () => {
    getTx.mockReturnValue(tx);
    const proxy = buildTenantAwareProxy(root, getTx);
    expect(proxy.then).toBeUndefined();
    expect(proxy[Symbol.toPrimitive]).toBe(root[Symbol.toPrimitive]);
  });

  it('preserves instanceof semantics', () => {
    class Fake {}
    const fake = new Fake();
    const proxy = buildTenantAwareProxy(fake as unknown as Record<string, unknown>, getTx);
    expect(proxy instanceof Fake).toBe(true);
  });
});
