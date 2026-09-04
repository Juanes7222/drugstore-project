/**
 * Lightweight publish/subscribe mechanism for SyncQueue entry creation.
 *
 * Domain services that create SyncQueue entries call `notifyPendingEntry()`
 * after their Prisma transaction commits, which fires the registered push
 * trigger (typically set up by SyncScheduler) to immediately push pending
 * entries instead of waiting for the next 5-minute sync cycle.
 *
 * This module intentionally has no React, no Prisma, and no I/O — it is
 * a pure callback holder so it can be imported anywhere without side effects.
 */

type PushTrigger = () => void;

const triggers = new Set<PushTrigger>();

/**
 * Register the push trigger callback.
 * Multiple triggers can be active — used by both the internet
 * SyncScheduler and the LAN LocalSyncEngine. Passing `null` clears
 * all registered triggers (used by tests and teardown).
 */
export function setPushTrigger(fn: PushTrigger | null): void {
  if (fn === null) {
    triggers.clear();
    return;
  }
  triggers.add(fn);
}

/** Remove a previously registered trigger. */
export function removePushTrigger(fn: PushTrigger): void {
  triggers.delete(fn);
}

/**
 * Notify that a new pending SyncQueue entry has been created.
 * Fires all registered push triggers as fire-and-forget calls.
 *
 * Safe to call from any context — each trigger runs asynchronously and
 * errors are swallowed by the trigger implementation.
 */
export function notifyPendingEntry(): void {
  for (const t of triggers) {
    try {
      t();
    } catch {
      // Fire-and-forget — the trigger implementation logs its own errors.
    }
  }
}
