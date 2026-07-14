/**
 * Format an ISO date string as a human-readable relative age.
 *
 * Example outputs: "just now", "5m ago", "3h ago", "2d ago".
 * Intentionally simple — no i18n, no pluralisation. For UI-localised age
 * formatting, see the function in recovery-page-view.tsx which uses t().
 */

export function formatAge(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffMin = Math.floor(diffMs / (60 * 1000));
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}
