/**
 * Tests for SyncQueueNotifier — lightweight callback holder that bridges
 * domain services (creators of SyncQueue entries) to the push trigger
 * (SyncScheduler.triggerPush).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setPushTrigger, notifyPendingEntry } from './sync-queue-notifier';

describe('sync-queue-notifier', () => {
  beforeEach(() => {
    setPushTrigger(null);
  });

  it('fires the registered trigger on notifyPendingEntry()', () => {
    const trigger = vi.fn();
    setPushTrigger(trigger);

    notifyPendingEntry();

    expect(trigger).toHaveBeenCalledOnce();
  });

  it('is a no-op when no trigger is registered', () => {
    expect(() => notifyPendingEntry()).not.toThrow();
  });

  it('clears the trigger when setPushTrigger(null) is called', () => {
    const trigger = vi.fn();
    setPushTrigger(trigger);
    setPushTrigger(null);

    notifyPendingEntry();

    expect(trigger).not.toHaveBeenCalled();
  });

  it('replaces the previous trigger on subsequent setPushTrigger calls', () => {
    const first = vi.fn();
    const second = vi.fn();
    setPushTrigger(first);
    setPushTrigger(second);

    notifyPendingEntry();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it('does not throw when the registered trigger throws', () => {
    setPushTrigger(() => {
      throw new Error('trigger error');
    });

    expect(() => notifyPendingEntry()).not.toThrow();
  });
});
