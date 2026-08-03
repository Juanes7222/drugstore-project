// Holds the subscriptionId of the request being processed plus the
// callback queue that must run only after the request's transaction commits.
// Populated by TenantContextInterceptor from the authenticated user.
import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

type AfterCommitCallback = () => void | Promise<void>;

export interface TenantStore {
  subscriptionId: string;
  afterCommit: AfterCommitCallback[];
}

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantStore>();

  /** Runs fn with the tenant bound in async-local storage. */
  runWithTenant<T>(subscriptionId: string, fn: () => T): T {
    return this.storage.run({ subscriptionId, afterCommit: [] }, fn);
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
   * Registers work to run after the current transaction commits. Callbacks
   * are best-effort: a failure is logged and must not roll back committed data.
   */
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