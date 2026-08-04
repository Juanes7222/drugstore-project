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
