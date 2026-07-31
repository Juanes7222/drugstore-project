/**
 * Convert ISO date-time strings to/from the `datetime-local` input format.
 *
 * The product form edits the commission validity window with
 * `input[type="datetime-local"]`, which works in the browser's local time,
 * while the API contract stores ISO date-times. These pure helpers bridge
 * the two without any timezone math of their own.
 */

const padTwo = (value: number): string => String(value).padStart(2, '0');

/**
 * Format an ISO date-time as a local `datetime-local` input value
 * (`YYYY-MM-DDTHH:mm`), or "" when the input is empty or unparseable.
 */
export const toLocalDateTimeInput = (
  iso: string | null | undefined,
): string => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const year = date.getFullYear();
  const month = padTwo(date.getMonth() + 1);
  const day = padTwo(date.getDate());
  const hours = padTwo(date.getHours());
  const minutes = padTwo(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

/**
 * Convert a `datetime-local` input value to an ISO date-time string, or
 * null when the input is empty or unparseable.
 */
export const toIsoDateTime = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};
