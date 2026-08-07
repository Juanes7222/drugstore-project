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
 * await dbWriteLock.acquire('foreground');
 * try {
 *   // … run queries / transaction …
 * } finally {
 *   dbWriteLock.release();
 * }
 * ```
 *
 * Each call site should hold the lock for the minimum time possible:
 *
 * - **Sale confirm / cash-shift writes (foreground):** acquire once around
 *   the entire `$transaction` callback (the transaction itself serializes
 *   within PGlite; without the lock the Prisma engine may time out waiting
 *   for the connection slot).  Foreground acquisitions jump the queue so a
 *   user action never waits behind queued background sync steps.
 * - **Sync steps (background, default):** acquire per sub-step (config,
 *   catalog, lots, clients, push) rather than for the whole cycle, so a
 *   foreground operation can interleave between steps.
 *
 * Cooperative background pause
 * ----------------------------
 * A foreground critical section that is long (e.g. a shift close, which
 * dumps the whole database to a backup) can call `pauseBackground()` before
 * acquiring.  Background callers check `isBackgroundPaused()` and skip their
 * work instead of queueing behind it; `resumeBackground()` restores normal
 * operation.  The pause is advisory — background callers must opt in by
 * checking the flag — and is not reentrant or reference-counted: the close
 * flow is the only producer today.
 *
 * Priority and the pause only reorder *queued* waiters.  If a background
 * step is already running when a foreground operation arrives, the
 * foreground still waits for that one in-flight step (which holds the lock
 * across its network fetch).  The residual wait is bounded to a single sync
 * step; eliminating it entirely would require moving sync network I/O
 * outside the lock.
 */
export type WriteLockPriority = 'background' | 'foreground';

export class WriteLock {
  private acquired = false;
  private queue: Array<() => void> = [];
  private backgroundPaused = false;

  /**
   * Wait until the lock is free, then acquire it.
   * Returns a promise that resolves when this caller holds the lock.
   * Callers are served in FIFO order, except `foreground` callers which
   * jump the queue so user-facing writes never wait behind background sync.
   */
  acquire(priority: WriteLockPriority = 'background'): Promise<void> {
    if (!this.acquired) {
      this.acquired = true;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      if (priority === 'foreground') {
        this.queue.unshift(resolve);
      } else {
        this.queue.push(resolve);
      }
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

  /**
   * Ask background callers (sync steps) to skip their work for the
   * duration of a foreground critical section.  Must be paired with
   * `resumeBackground()` — typically in the same `finally` that
   * releases the lock.
   */
  pauseBackground(): void {
    this.backgroundPaused = true;
  }

  /** Resume normal background operation after a pause. */
  resumeBackground(): void {
    this.backgroundPaused = false;
  }

  /** `true` while a foreground critical section has paused the background. */
  isBackgroundPaused(): boolean {
    return this.backgroundPaused;
  }
}

/** Singleton shared across all domain services and the sync scheduler. */
export const dbWriteLock = new WriteLock();
