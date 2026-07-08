/**
 * Network-status check for the POS desktop app.
 *
 * Returns `true` when the Tauri webview reports connectivity via the
 * `navigator.onLine` property.  This is a standalone function (not a
 * React hook) so it can be called from services and the sync scheduler
 * without a component lifecycle.
 *
 * Relies on the browser's online/offline events which Tauri forwards
 * from the OS network-status notifications.
 */

export const isOnline = (): boolean => {
  if (typeof navigator === 'undefined') {
    // Non-browser context (tests, SSR): assume offline so nothing
    // tries to reach the network unexpectedly.
    return false;
  }
  return navigator.onLine;
};
