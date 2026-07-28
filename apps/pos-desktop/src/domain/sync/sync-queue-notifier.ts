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

let trigger: PushTrigger | null = null;

/**
 * Register the push trigger callback.
 * Only one trigger can be active at a time; subsequent calls replace it.
 * Pass `null` to clear.
 */
export function setPushTrigger(fn: PushTrigger | null): void {
  trigger = fn;
}

/**
 * Notify that a new pending SyncQueue entry has been created.
 * Fires the registered push trigger (if any) as a fire-and-forget call.
 *
 * Safe to call from any context — the trigger runs asynchronously and
 * errors are swallowed by the trigger implementation.
 */
export function notifyPendingEntry(): void {
  try {
    trigger?.();
  } catch {
    // Fire-and-forget — the trigger implementation logs its own errors.
  }
}
