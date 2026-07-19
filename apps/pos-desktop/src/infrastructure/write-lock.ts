/**
 * Promise-based FIFO write lock for serializing access to the single PGlite
 * connection.
 *
 * PGlite processes queries on a single connection — interactive Prisma
 * transactions (`$transaction` with callback) hold that connection for
 * their duration.  Without coordination, a background sync cycle can
 * starve a foreground sale confirm and vice-versa.  Traditional timeouts
 * just hide the problem; this lock explicitly queues callers so they run
 * one at a time without busy-waiting or arbitrary timeouts.
 *
 * Usage
 * -----
 * ```
 * import { dbWriteLock } from '../../infrastructure/write-lock';
 *
 * await dbWriteLock.acquire();
 * try {
 *   // … run queries / transaction …
 * } finally {
 *   dbWriteLock.release();
 * }
 * ```
 *
 * Each call site should hold the lock for the minimum time possible:
 *
 * - **Sale confirm:** acquire once around the entire `$transaction` callback
 *   (the transaction itself serializes within PGlite; without the lock the
 *   Prisma engine may time out waiting for the connection slot).
 * - **Sync steps:** acquire per sub-step (config, catalog, lots, clients,
 *   push) rather than for the whole cycle, so a foreground sale can
 *   interleave between steps.
 */
export class WriteLock {
  private acquired = false;
  private queue: Array<() => void> = [];

  /**
   * Wait until the lock is free, then acquire it.
   * Returns a promise that resolves when this caller holds the lock.
   * Callers are served in FIFO order.
   */
  acquire(): Promise<void> {
    if (!this.acquired) {
      this.acquired = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  /**
   * Release the lock and let the next waiter (if any) proceed.
   * Safe to call multiple times — subsequent calls are no-ops when
   * the queue is already empty.
   */
  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Hand the lock to the next waiter synchronously so there is
      // never a gap where `acquired` is false and a caller sees it.
      next();
    } else {
      this.acquired = false;
    }
  }
}

/** Singleton shared across all domain services and the sync scheduler. */
export const dbWriteLock = new WriteLock();
