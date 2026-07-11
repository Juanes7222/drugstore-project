/**
 * Human-readable relative-time formatting.
 *
 * Both functions accept ISO 8601 strings and return short labels such as
 * "just now", "5m ago", "3h ago", "2d ago" or a locale-formatted date for
 * anything older than a week.
 *
 * @module time-format
 */

/**
 * Format an ISO timestamp as a relative label intended for short-lived
 * status indicators (e.g. "last attempt 2m ago").
 */
export function formatRelativeTime(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Format an ISO timestamp as a backup-age label.
 *
 * Distinct from `formatRelativeTime` because backup monitoring panels often
 * display age differently (e.g. "3d ago" at the day level rather than
 * falling back to a full date).
 */
export function formatBackupAge(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
