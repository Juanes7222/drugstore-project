// Holds the subscriptionId of the request being processed, the active
// request-scoped transaction (set by PrismaService so `this.prisma.<model>`
// routes to it via the tenant-aware proxy), plus the callback queue that
// must run only after the request's transaction commits.
// Populated by TenantContextInterceptor from the authenticated user.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@pharmacy/database';

type AfterCommitCallback = () => void | Promise<void>;

export interface TenantStore {
  subscriptionId: string;
  /** Active request transaction, or null outside any withTenant scope. */
  tx: Prisma.TransactionClient | null;
  afterCommit: AfterCommitCallback[];
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantStore>();

  /** Runs fn with the tenant bound in async-local storage. */
  runWithTenant<T>(subscriptionId: string, fn: () => T): T {
    return this.storage.run({ subscriptionId, tx: null, afterCommit: [] }, fn);
  }

  /** Subscription id of the current request; throws outside any context. */
  getSubscriptionId(): string {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error('TenantContextService: no tenant in context');
    }
    return store.subscriptionId;
  }

  hasTenant(): boolean {
    return this.storage.getStore() !== undefined;
  }

  /**
   * Binds the active request transaction to the current context. Called by
   * PrismaService.runWithTenant before the handler runs so the
   * tenant-aware proxy routes `this.prisma.<model>` calls into the
   * transaction (the RLS `SET LOCAL` context lives there).
   */
  setTx(tx: Prisma.TransactionClient): void {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error('TenantContextService: tx set outside a tenant context');
    }
    store.tx = tx;
  }

  /** Active request transaction, or null when none is bound. */
  getTx(): Prisma.TransactionClient | null {
    return this.storage.getStore()?.tx ?? null;
  }

  /** Unbinds the active transaction (called when the request transaction ends). */
  clearTx(): void {
    const store = this.storage.getStore();
    if (store) {
      store.tx = null;
    }
  }

  /**
   * Registers work to run after the current transaction commits. Callbacks
   * are best-effort: a failure is logged and must not roll back committed data.
   */
  registerAfterCommit(callback: AfterCommitCallback): void {
    const store = this.storage.getStore();
    if (!store) {
      throw new Error(
        'TenantContextService: afterCommit registered outside a tenant context',
      );
    }
    store.afterCommit.push(callback);
  }

  /**
   * Runs every registered afterCommit callback. Called by PrismaService after
   * the request transaction has committed. Failures are logged, not thrown:
   * the request already succeeded and its data is durable.
   */
  async drainAfterCommit(): Promise<void> {
    const store = this.storage.getStore();
    if (!store || store.afterCommit.length === 0) return;
    const callbacks = store.afterCommit.splice(0);
    for (const callback of callbacks) {
      try {
        await callback();
      } catch (error) {
        console.error(
          '[TenantContextService] afterCommit callback failed:',
          error,
        );
      }
    }
  }
}
