/**
 * Locale-aware relative time formatter using Intl.RelativeTimeFormat.
 *
 * Returns Spanish short labels ("ahora", "hace 5m", "hace 3h", "hace 2d")
 * or a locale-formatted date for anything older than a week.
 * Drop-in replacement for the English-only common/time-format.
 *
 * @category Hook
 */

const RTF = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

export function formatRelativeTimeEs(isoString: string): string {
  const date = new Date(isoString);
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const absSec = Math.abs(diffSec);
  const diffMin = Math.floor(absSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (absSec < 10) return RTF.format(0, "second");
  if (diffMin < 1) return "menos de 1m";
  if (diffMin < 60) return RTF.format(-diffMin, "minute");
  if (diffHours < 24) return RTF.format(-diffHours, "hour");
  if (diffDays < 7) return RTF.format(-diffDays, "day");
  return date.toLocaleDateString("es", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
