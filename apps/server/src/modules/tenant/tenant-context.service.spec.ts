import { TenantContextService } from './tenant-context.service';

describe('TenantContextService', () => {
  let service: TenantContextService;

  beforeEach(() => {
    service = new TenantContextService();
  });

  it('throws getSubscriptionId outside any context', () => {
    expect(() => service.getSubscriptionId()).toThrow(
      'no tenant in context',
    );
  });

  it('returns null tx outside any context', () => {
    expect(service.getTx()).toBeNull();
  });

  it('throws when registering afterCommit outside a context', () => {
    expect(() => service.registerAfterCommit(() => undefined)).toThrow(
      'outside a tenant context',
    );
  });

  it('binds subscriptionId and tx within runWithTenant', async () => {
    const fakeTx = { sale: { findMany: 1 } };
    let seen: { id: string; tx: unknown };
    await service.runWithTenant('sub-1', () => {
      service.setTx(fakeTx as never);
      seen = { id: service.getSubscriptionId(), tx: service.getTx() };
    });
    expect(seen).toEqual({ id: 'sub-1', tx: fakeTx });
    expect(service.getTx()).toBeNull();
  });

  it('restores the outer tx after a nested runWithTenant', async () => {
    const outerTx = { sale: { findMany: 1 } };
    const innerTx = { sale: { findMany: 2 } };
    let innerSeen: unknown;
    let afterInner: unknown;
    await service.runWithTenant('outer', () => {
      service.setTx(outerTx as never);
      service.runWithTenant('inner', () => {
        service.setTx(innerTx as never);
        innerSeen = { id: service.getSubscriptionId(), tx: service.getTx() };
      });
      afterInner = service.getTx();
    });
    expect(innerSeen).toEqual({ id: 'inner', tx: innerTx });
    expect(afterInner).toBe(outerTx);
  });

  /**
   * Nested `$transaction` calls are savepoints: Prisma requires each one to be
   * issued from the innermost client, so the model calls inside its callback
   * must resolve to that savepoint and the enclosing transaction must be back
   * in place afterwards.
   */
  it('binds the nested tx during runWithTx and restores the outer one', async () => {
    const outerTx = { sale: { findMany: 1 } };
    const nestedTx = { sale: { findMany: 2 } };
    let duringNested: unknown;
    let afterNested: unknown;

    await service.runWithTenant('sub-1', async () => {
      service.setTx(outerTx as never);
      await service.runWithTx(nestedTx as never, async () => {
        duringNested = service.getTx();
      });
      afterNested = service.getTx();
    });

    expect(duringNested).toBe(nestedTx);
    expect(afterNested).toBe(outerTx);
  });

  it('restores the outer tx when the nested callback throws', async () => {
    const outerTx = { sale: { findMany: 1 } };
    let afterThrow: unknown;

    await service.runWithTenant('sub-1', async () => {
      service.setTx(outerTx as never);
      await expect(
        service.runWithTx({ sale: { findMany: 2 } } as never, async () => {
          throw new Error('nested failed');
        }),
      ).rejects.toThrow('nested failed');
      afterThrow = service.getTx();
    });

    expect(afterThrow).toBe(outerTx);
  });

  it('reports hasTenant false outside any context', () => {
    expect(service.hasTenant()).toBe(false);
  });

  it('reports hasTenant true inside runWithTenant and false after', async () => {
    let seenInside: boolean;
    await service.runWithTenant('sub-1', () => {
      seenInside = service.hasTenant();
    });
    expect(seenInside).toBe(true);
    expect(service.hasTenant()).toBe(false);
  });

  it('unbinds the tx on clearTx', async () => {
    const fakeTx = { sale: { findMany: 1 } };
    let afterClear: unknown;
    await service.runWithTenant('sub-1', () => {
      service.setTx(fakeTx as never);
      service.clearTx();
      afterClear = service.getTx();
    });
    expect(afterClear).toBeNull();
  });

  it('does not throw when clearTx runs outside any context', () => {
    expect(() => service.clearTx()).not.toThrow();
  });

  it('drains afterCommit callbacks in registration order', async () => {
    const order: string[] = [];
    await service.runWithTenant('sub-1', async () => {
      service.registerAfterCommit(async () => {
        order.push('a');
      });
      service.registerAfterCommit(() => {
        order.push('b');
      });
      await service.drainAfterCommit();
    });
    expect(order).toEqual(['a', 'b']);
  });

  it('keeps draining when a callback fails (best effort, never throws)', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const order: string[] = [];
    await service.runWithTenant('sub-1', async () => {
      service.registerAfterCommit(() => {
        throw new Error('boom');
      });
      service.registerAfterCommit(() => {
        order.push('ok');
      });
      await service.drainAfterCommit();
    });
    expect(order).toEqual(['ok']);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
